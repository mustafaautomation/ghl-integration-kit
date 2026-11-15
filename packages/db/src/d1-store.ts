import { identityKeys, newId, type InstallationRecord, type NormalizedLead, type StoredLead } from '@ghl/domain/edge';
import type { SqlDb } from './sql-db.js';
import type {
  InspectionRow,
  LeadDetailRow,
  LeadListRow,
  OfferRow,
  OperatorStore,
  StoredEvent,
} from './store.js';

interface LeadRow {
  id: string;
  correlation_id: string;
  source: string;
  external_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone_e164: string | null;
  custom: string;
  tags: string;
  attribution: string;
  status: string;
  contact_id: string | null;
  opportunity_id: string | null;
  appointment_id: string | null;
  sms_message_id: string | null;
  email_message_id: string | null;
  created_at: string;
}

interface InstallRow {
  location_id: string;
  company_id: string | null;
  user_id: string | null;
  user_type: string;
  access_token_enc: string;
  refresh_token_enc: string;
  expires_at: string;
  scope: string;
  uninstalled_at: string | null;
}

function json<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function uniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}

function toStored(row: LeadRow): StoredLead {
  return {
    id: row.id,
    correlationId: row.correlation_id,
    source: row.source as StoredLead['source'],
    externalId: row.external_id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email ?? undefined,
    phoneE164: row.phone_e164 ?? undefined,
    custom: json<Record<string, string>>(row.custom, {}),
    tags: json<string[]>(row.tags, []),
    attribution: json(row.attribution, { source: row.source }),
    receivedAt: row.created_at,
    status: row.status,
    contactId: row.contact_id ?? undefined,
    opportunityId: row.opportunity_id ?? undefined,
    appointmentId: row.appointment_id ?? undefined,
    smsMessageId: row.sms_message_id ?? undefined,
    emailMessageId: row.email_message_id ?? undefined,
  };
}

function flag(value: number | boolean): boolean {
  return value === true || value === 1;
}

function toInstall(row: InstallRow): InstallationRecord {
  return {
    locationId: row.location_id,
    companyId: row.company_id ?? undefined,
    userId: row.user_id ?? undefined,
    userType: row.user_type === 'Company' ? 'Company' : 'Location',
    accessTokenEnc: row.access_token_enc,
    refreshTokenEnc: row.refresh_token_enc,
    expiresAt: new Date(row.expires_at),
    scope: row.scope,
    uninstalledAt: row.uninstalled_at ? new Date(row.uninstalled_at) : null,
  };
}

export class D1Store implements OperatorStore {
  constructor(private readonly db: SqlDb) {}

  async ping(): Promise<boolean> {
    const row = await this.db.prepare('SELECT 1 AS ok').first<{ ok: number }>();
    return row?.ok === 1;
  }

  async clearDemo(): Promise<void> {
    const statements = [
      'DELETE FROM lead_events',
      'DELETE FROM offered_slots',
      'DELETE FROM leads',
      'DELETE FROM identities',
      'DELETE FROM webhook_inspections',
      'DELETE FROM webhook_events',
      'DELETE FROM jobs',
      'DELETE FROM rate_limits',
    ];
    for (const statement of statements) {
      await this.db.prepare(statement).run();
    }
  }

  async latestActive(): Promise<InstallationRecord | null> {
    const row = await this.db
      .prepare(`SELECT * FROM installations WHERE uninstalled_at IS NULL ORDER BY updated_at DESC LIMIT 1`)
      .first<InstallRow>();
    return row ? toInstall(row) : null;
  }

  async get(locationId: string): Promise<InstallationRecord | null> {
    const row = await this.db.prepare('SELECT * FROM installations WHERE location_id = ?').bind(locationId).first<InstallRow>();
    return row ? toInstall(row) : null;
  }

  async save(record: InstallationRecord): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT INTO installations (
          location_id, company_id, user_id, user_type, access_token_enc, refresh_token_enc,
          expires_at, scope, uninstalled_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(location_id) DO UPDATE SET
          company_id = excluded.company_id,
          user_id = excluded.user_id,
          user_type = excluded.user_type,
          access_token_enc = excluded.access_token_enc,
          refresh_token_enc = excluded.refresh_token_enc,
          expires_at = excluded.expires_at,
          scope = excluded.scope,
          uninstalled_at = excluded.uninstalled_at,
          updated_at = excluded.updated_at`,
      )
      .bind(
        record.locationId,
        record.companyId ?? null,
        record.userId ?? null,
        record.userType,
        record.accessTokenEnc,
        record.refreshTokenEnc,
        record.expiresAt.toISOString(),
        record.scope,
        record.uninstalledAt ? record.uninstalledAt.toISOString() : null,
        now,
        now,
      )
      .run();
  }

  async insertState(state: string, expiresAt: Date): Promise<void> {
    await this.db.prepare('INSERT INTO oauth_states (state, expires_at) VALUES (?, ?)').bind(state, expiresAt.toISOString()).run();
  }

  async takeState(state: string): Promise<{ expiresAt: Date; usedAt: Date | null } | null> {
    const row = await this.db
      .prepare('SELECT expires_at, used_at FROM oauth_states WHERE state = ?')
      .bind(state)
      .first<{ expires_at: string; used_at: string | null }>();
    if (!row) return null;
    return { expiresAt: new Date(row.expires_at), usedAt: row.used_at ? new Date(row.used_at) : null };
  }

  async markStateUsed(state: string, usedAt: Date): Promise<void> {
    await this.db.prepare('UPDATE oauth_states SET used_at = ? WHERE state = ?').bind(usedAt.toISOString(), state).run();
  }

  async tryInsertEvent(eventId: string, source: string): Promise<'inserted' | 'duplicate'> {
    try {
      await this.db
        .prepare('INSERT INTO webhook_events (event_id, source, status, received_at) VALUES (?, ?, ?, ?)')
        .bind(eventId, source, 'accepted', new Date().toISOString())
        .run();
      return 'inserted';
    } catch (error) {
      if (uniqueViolation(error)) return 'duplicate';
      throw error;
    }
  }

  async inspect(input: {
    source: string;
    eventId: string | null;
    signatureValid: boolean;
    idempotentHit: boolean;
    statusCode: number;
    reason: string | null;
    rawBody: string;
    headers: Record<string, string>;
  }): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO webhook_inspections (
          source, event_id, signature_valid, idempotent_hit, status_code, reason, raw_body, headers, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.source,
        input.eventId,
        input.signatureValid ? 1 : 0,
        input.idempotentHit ? 1 : 0,
        input.statusCode,
        input.reason,
        input.rawBody.slice(0, 20_000),
        JSON.stringify(input.headers),
        new Date().toISOString(),
      )
      .run();
  }

  async listInspections(limit = 50): Promise<InspectionRow[]> {
    const rows = await this.db
      .prepare(
        `SELECT id, source, event_id, signature_valid, idempotent_hit, status_code, reason, raw_body, headers, created_at
         FROM webhook_inspections ORDER BY id DESC LIMIT ?`,
      )
      .bind(limit)
      .all<{
        id: number;
        source: string;
        event_id: string | null;
        signature_valid: number;
        idempotent_hit: number;
        status_code: number;
        reason: string | null;
        raw_body: string;
        headers: string;
        created_at: string;
      }>();
    return rows.results.map((row) => ({
      id: Number(row.id),
      source: row.source,
      eventId: row.event_id,
      signatureValid: flag(row.signature_valid),
      idempotentHit: flag(row.idempotent_hit),
      statusCode: Number(row.status_code),
      reason: row.reason,
      rawBody: row.raw_body,
      headers: json<Record<string, string>>(row.headers, {}),
      createdAt: new Date(row.created_at),
    }));
  }

  async createLead(lead: NormalizedLead, raw: unknown): Promise<StoredLead> {
    const id = newId('lead');
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT INTO leads (
          id, correlation_id, source, external_id, first_name, last_name, email, phone_e164,
          custom, tags, attribution, status, raw, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'received', ?, ?, ?)`,
      )
      .bind(
        id,
        id,
        lead.source,
        lead.externalId,
        lead.firstName,
        lead.lastName,
        lead.email ?? null,
        lead.phoneE164 ?? null,
        JSON.stringify(lead.custom),
        JSON.stringify(lead.tags),
        JSON.stringify(lead.attribution),
        JSON.stringify(raw),
        now,
        now,
      )
      .run();
    return {
      ...lead,
      id,
      correlationId: id,
      status: 'received',
      receivedAt: now,
    };
  }

  async getLead(id: string): Promise<StoredLead> {
    const row = await this.db.prepare('SELECT * FROM leads WHERE id = ?').bind(id).first<LeadRow>();
    if (!row) throw new Error('missing_lead');
    return toStored(row);
  }

  async saveLead(lead: StoredLead): Promise<void> {
    await this.db
      .prepare(
        `UPDATE leads SET status = ?, contact_id = ?, opportunity_id = ?, appointment_id = ?,
          sms_message_id = ?, email_message_id = ?, updated_at = ? WHERE id = ?`,
      )
      .bind(
        lead.status,
        lead.contactId ?? null,
        lead.opportunityId ?? null,
        lead.appointmentId ?? null,
        lead.smsMessageId ?? null,
        lead.emailMessageId ?? null,
        new Date().toISOString(),
        lead.id,
      )
      .run();
  }

  async addEvent(
    leadId: string,
    event: { type: string; status: 'ok' | 'error' | 'skipped'; detail?: Record<string, unknown> },
  ): Promise<void> {
    await this.db
      .prepare('INSERT INTO lead_events (lead_id, type, status, detail, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(leadId, event.type, event.status, JSON.stringify(event.detail ?? {}), new Date().toISOString())
      .run();
  }

  async findIdentity(email?: string, phoneE164?: string) {
    const keys = identityKeys(email, phoneE164);
    if (keys.length === 0) return null;
    const placeholders = keys.map(() => '?').join(', ');
    const rows = await this.db
      .prepare(`SELECT key, contact_id, opportunity_id FROM identities WHERE key IN (${placeholders})`)
      .bind(...keys)
      .all<{ key: string; contact_id: string; opportunity_id: string | null }>();
    const emailKey = email ? `email:${email.trim().toLowerCase()}` : undefined;
    const match = rows.results.find((row) => row.key === emailKey) ?? rows.results[0];
    if (!match) return null;
    return { contactId: match.contact_id, openOpportunityId: match.opportunity_id ?? undefined };
  }

  async rememberIdentity(email: string | undefined, phoneE164: string | undefined, contactId: string, opportunityId?: string) {
    const now = new Date().toISOString();
    for (const key of identityKeys(email, phoneE164)) {
      await this.db
        .prepare(
          `INSERT INTO identities (key, contact_id, opportunity_id, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET contact_id = excluded.contact_id, opportunity_id = excluded.opportunity_id, updated_at = excluded.updated_at`,
        )
        .bind(key, contactId, opportunityId ?? null, now)
        .run();
    }
  }

  async saveSlots(leadId: string, slots: string[]): Promise<void> {
    await this.db.prepare('DELETE FROM offered_slots WHERE lead_id = ?').bind(leadId).run();
    const now = new Date().toISOString();
    for (const startTime of slots) {
      await this.db
        .prepare('INSERT INTO offered_slots (lead_id, start_time, created_at) VALUES (?, ?, ?)')
        .bind(leadId, startTime, now)
        .run();
    }
  }

  async listLeads(limit = 50): Promise<LeadListRow[]> {
    const rows = await this.db
      .prepare(
        `SELECT id, first_name, last_name, source, status, email, phone_e164, created_at
         FROM leads ORDER BY created_at DESC LIMIT ?`,
      )
      .bind(limit)
      .all<{
        id: string;
        first_name: string;
        last_name: string;
        source: string;
        status: string;
        email: string | null;
        phone_e164: string | null;
        created_at: string;
      }>();
    return rows.results.map((row) => ({
      id: row.id,
      name: `${row.first_name} ${row.last_name}`.trim(),
      source: row.source,
      status: row.status,
      email: row.email,
      phoneE164: row.phone_e164,
      createdAt: row.created_at,
    }));
  }

  async detail(id: string): Promise<LeadDetailRow | null> {
    const row = await this.db.prepare('SELECT * FROM leads WHERE id = ?').bind(id).first<LeadRow>();
    if (!row) return null;
    const events = await this.eventsFor(id);
    const slots = await this.db
      .prepare('SELECT start_time FROM offered_slots WHERE lead_id = ? ORDER BY id')
      .bind(id)
      .all<{ start_time: string }>();
    return {
      lead: { ...toStored(row), createdAt: row.created_at },
      events,
      slots: slots.results.map((slot) => slot.start_time),
    };
  }

  async openOffers(): Promise<OfferRow[]> {
    const rows = await this.db
      .prepare(
        `SELECT s.lead_id, s.start_time, l.first_name, l.last_name, l.status
         FROM offered_slots s INNER JOIN leads l ON l.id = s.lead_id
         WHERE l.status = 'offered'`,
      )
      .all<{ lead_id: string; start_time: string; first_name: string; last_name: string; status: string }>();
    return rows.results.map((row) => ({
      leadId: row.lead_id,
      startTime: row.start_time,
      name: `${row.first_name} ${row.last_name}`.trim(),
      status: row.status,
    }));
  }

  async activityStamps() {
    const leads = await this.db.prepare('SELECT created_at AS at FROM leads').all<{ at: string }>();
    const messages = await this.db
      .prepare(`SELECT created_at AS at FROM lead_events WHERE type IN ('sms_sent', 'email_sent', 'text_back')`)
      .all<{ at: string }>();
    const booked = await this.db.prepare(`SELECT created_at AS at FROM lead_events WHERE type = 'booked'`).all<{ at: string }>();
    return {
      leads: leads.results.map((row) => new Date(row.at)),
      messages: messages.results.map((row) => new Date(row.at)),
      booked: booked.results.map((row) => new Date(row.at)),
    };
  }

  async stats() {
    const leads = await this.db.prepare('SELECT count(*) AS n FROM leads').first<{ n: number }>();
    const messages = await this.db
      .prepare(`SELECT count(*) AS n FROM lead_events WHERE type IN ('sms_sent', 'email_sent', 'text_back')`)
      .first<{ n: number }>();
    const booked = await this.db.prepare(`SELECT count(*) AS n FROM leads WHERE status = 'booked'`).first<{ n: number }>();
    return { leads: Number(leads?.n ?? 0), messages: Number(messages?.n ?? 0), booked: Number(booked?.n ?? 0) };
  }

  async eventsFor(leadId: string | undefined): Promise<StoredEvent[]> {
    const rows = leadId
      ? await this.db
          .prepare('SELECT id, lead_id, type, status, detail, created_at FROM lead_events WHERE lead_id = ? ORDER BY id')
          .bind(leadId)
          .all<EventRow>()
      : await this.db
          .prepare('SELECT id, lead_id, type, status, detail, created_at FROM lead_events ORDER BY id DESC LIMIT 30')
          .all<EventRow>();
    const mapped = rows.results.map(toEvent);
    return leadId ? mapped : mapped.reverse();
  }
}

interface EventRow {
  id: number;
  lead_id: string;
  type: string;
  status: string;
  detail: string;
  created_at: string;
}

function toEvent(row: EventRow): StoredEvent {
  return {
    id: Number(row.id),
    leadId: row.lead_id,
    type: row.type,
    status: row.status,
    detail: json<Record<string, unknown>>(row.detail, {}),
    createdAt: row.created_at,
  };
}
