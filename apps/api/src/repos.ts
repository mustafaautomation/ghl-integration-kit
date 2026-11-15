import {
  identities,
  installations,
  leadEvents,
  leads,
  oauthStates,
  offeredSlots,
  webhookEvents,
  webhookInspections,
  type Database,
} from '@ghl/db';
import {
  identityKeys,
  newId,
  type InstallationRecord,
  type InstallationStore,
  type LeadSourceId,
  type NormalizedLead,
  type StoredLead,
} from '@ghl/domain';
import { desc, eq, inArray, sql } from 'drizzle-orm';
import type { Bus, LiveEvent } from './bus.js';

function uniqueViolation(error: unknown): boolean {
  const candidate = error as { code?: string; cause?: { code?: string } };
  return candidate.code === '23505' || candidate.cause?.code === '23505';
}

function toStored(row: typeof leads.$inferSelect): StoredLead {
  return {
    id: row.id,
    correlationId: row.correlationId,
    source: row.source as LeadSourceId,
    externalId: row.externalId,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email ?? undefined,
    phoneE164: row.phoneE164 ?? undefined,
    custom: row.custom,
    tags: row.tags,
    attribution: row.attribution,
    receivedAt: row.createdAt.toISOString(),
    status: row.status,
    contactId: row.contactId ?? undefined,
    opportunityId: row.opportunityId ?? undefined,
    appointmentId: row.appointmentId ?? undefined,
    smsMessageId: row.smsMessageId ?? undefined,
    emailMessageId: row.emailMessageId ?? undefined,
  };
}

export interface LeadDetail {
  lead: StoredLead & { createdAt: string };
  events: LiveEvent[];
  slots: string[];
}

export class Repositories implements InstallationStore {
  constructor(
    private readonly db: Database,
    private readonly bus: Bus,
  ) {}

  async get(locationId: string): Promise<InstallationRecord | null> {
    const [row] = await this.db.select().from(installations).where(eq(installations.locationId, locationId)).limit(1);
    if (!row) return null;
    return {
      locationId: row.locationId,
      companyId: row.companyId ?? undefined,
      userId: row.userId ?? undefined,
      userType: row.userType === 'Company' ? 'Company' : 'Location',
      accessTokenEnc: row.accessTokenEnc,
      refreshTokenEnc: row.refreshTokenEnc,
      expiresAt: row.expiresAt,
      scope: row.scope,
      uninstalledAt: row.uninstalledAt,
    };
  }

  async save(record: InstallationRecord): Promise<void> {
    const values = {
      locationId: record.locationId,
      companyId: record.companyId ?? null,
      userId: record.userId ?? null,
      userType: record.userType,
      accessTokenEnc: record.accessTokenEnc,
      refreshTokenEnc: record.refreshTokenEnc,
      expiresAt: record.expiresAt,
      scope: record.scope,
      uninstalledAt: record.uninstalledAt,
      updatedAt: new Date(),
    };
    await this.db
      .insert(installations)
      .values(values)
      .onConflictDoUpdate({ target: installations.locationId, set: values });
  }

  async insertState(state: string, expiresAt: Date): Promise<void> {
    await this.db.insert(oauthStates).values({ state, expiresAt });
  }

  async takeState(state: string): Promise<{ expiresAt: Date; usedAt: Date | null } | null> {
    const [row] = await this.db.select().from(oauthStates).where(eq(oauthStates.state, state)).limit(1);
    return row ? { expiresAt: row.expiresAt, usedAt: row.usedAt } : null;
  }

  async markStateUsed(state: string, usedAt: Date): Promise<void> {
    await this.db.update(oauthStates).set({ usedAt }).where(eq(oauthStates.state, state));
  }

  async tryInsertEvent(eventId: string, source: string): Promise<'inserted' | 'duplicate'> {
    try {
      await this.db.insert(webhookEvents).values({ eventId, source, status: 'accepted' });
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
    await this.db.insert(webhookInspections).values({
      ...input,
      rawBody: input.rawBody.slice(0, 20_000),
    });
  }

  async listInspections(limit = 50) {
    return this.db.select().from(webhookInspections).orderBy(desc(webhookInspections.id)).limit(limit);
  }

  async createLead(lead: NormalizedLead, raw: unknown): Promise<StoredLead> {
    const id = newId('lead');
    const [row] = await this.db
      .insert(leads)
      .values({
        id,
        correlationId: id,
        source: lead.source,
        externalId: lead.externalId,
        firstName: lead.firstName,
        lastName: lead.lastName,
        email: lead.email ?? null,
        phoneE164: lead.phoneE164 ?? null,
        custom: lead.custom,
        tags: lead.tags,
        attribution: lead.attribution,
        status: 'received',
        raw,
      })
      .returning();
    if (!row) throw new Error('lead_insert_failed');
    return toStored(row);
  }

  async getLead(id: string): Promise<StoredLead> {
    const [row] = await this.db.select().from(leads).where(eq(leads.id, id)).limit(1);
    if (!row) throw new Error('missing_lead');
    return toStored(row);
  }

  async saveLead(lead: StoredLead): Promise<void> {
    await this.db
      .update(leads)
      .set({
        status: lead.status,
        contactId: lead.contactId ?? null,
        opportunityId: lead.opportunityId ?? null,
        appointmentId: lead.appointmentId ?? null,
        smsMessageId: lead.smsMessageId ?? null,
        emailMessageId: lead.emailMessageId ?? null,
        updatedAt: new Date(),
      })
      .where(eq(leads.id, lead.id));
  }

  async addEvent(
    leadId: string,
    event: { type: string; status: 'ok' | 'error' | 'skipped'; detail?: Record<string, unknown> },
  ): Promise<void> {
    const [row] = await this.db
      .insert(leadEvents)
      .values({
        leadId,
        type: event.type,
        status: event.status,
        detail: event.detail ?? {},
      })
      .returning();
    if (!row) return;
    this.bus.publish({
      id: Number(row.id),
      leadId,
      type: row.type,
      status: row.status,
      detail: row.detail,
      createdAt: row.createdAt.toISOString(),
    });
  }

  async findIdentity(email?: string, phoneE164?: string) {
    const keys = identityKeys(email, phoneE164);
    if (keys.length === 0) return null;
    const rows = await this.db.select().from(identities).where(inArray(identities.key, keys));
    const emailKey = email ? `email:${email.trim().toLowerCase()}` : undefined;
    const match = rows.find((row) => row.key === emailKey) ?? rows[0];
    if (!match) return null;
    return { contactId: match.contactId, openOpportunityId: match.opportunityId ?? undefined };
  }

  async rememberIdentity(email: string | undefined, phoneE164: string | undefined, contactId: string, opportunityId?: string) {
    const now = new Date();
    for (const key of identityKeys(email, phoneE164)) {
      await this.db
        .insert(identities)
        .values({ key, contactId, opportunityId: opportunityId ?? null, updatedAt: now })
        .onConflictDoUpdate({
          target: identities.key,
          set: { contactId, opportunityId: opportunityId ?? null, updatedAt: now },
        });
    }
  }

  async saveSlots(leadId: string, slots: string[]): Promise<void> {
    await this.db.delete(offeredSlots).where(eq(offeredSlots.leadId, leadId));
    if (slots.length === 0) return;
    await this.db.insert(offeredSlots).values(slots.map((startTime) => ({ leadId, startTime })));
  }

  async listLeads(limit = 50) {
    const rows = await this.db.select().from(leads).orderBy(desc(leads.createdAt)).limit(limit);
    return rows.map((row) => ({
      id: row.id,
      name: `${row.firstName} ${row.lastName}`.trim(),
      source: row.source,
      status: row.status,
      email: row.email,
      phoneE164: row.phoneE164,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async detail(id: string): Promise<LeadDetail | null> {
    const [row] = await this.db.select().from(leads).where(eq(leads.id, id)).limit(1);
    if (!row) return null;
    const events = await this.db.select().from(leadEvents).where(eq(leadEvents.leadId, id)).orderBy(leadEvents.id);
    const slots = await this.db.select().from(offeredSlots).where(eq(offeredSlots.leadId, id)).orderBy(offeredSlots.id);
    return {
      lead: { ...toStored(row), createdAt: row.createdAt.toISOString() },
      events: events.map((event) => ({
        id: Number(event.id),
        leadId: id,
        type: event.type,
        status: event.status,
        detail: event.detail,
        createdAt: event.createdAt.toISOString(),
      })),
      slots: slots.map((slot) => slot.startTime),
    };
  }

  async stats() {
    const [leadCount] = await this.db.select({ n: sql<number>`count(*)::int` }).from(leads);
    const [messageCount] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(leadEvents)
      .where(inArray(leadEvents.type, ['sms_sent', 'email_sent', 'text_back']));
    const [bookedCount] = await this.db.select({ n: sql<number>`count(*)::int` }).from(leads).where(eq(leads.status, 'booked'));
    return {
      leads: Number(leadCount?.n ?? 0),
      messages: Number(messageCount?.n ?? 0),
      booked: Number(bookedCount?.n ?? 0),
    };
  }

  async eventsFor(leadId: string | undefined): Promise<LiveEvent[]> {
    const rows = leadId
      ? await this.db.select().from(leadEvents).where(eq(leadEvents.leadId, leadId)).orderBy(leadEvents.id)
      : await this.db.select().from(leadEvents).orderBy(desc(leadEvents.id)).limit(30);
    return rows.map((event) => ({
      id: Number(event.id),
      leadId: event.leadId,
      type: event.type,
      status: event.status,
      detail: event.detail,
      createdAt: event.createdAt.toISOString(),
    }));
  }
}

export function flowLeadApi(repos: Repositories) {
  return {
    get: (id: string) => repos.getLead(id),
    save: (lead: StoredLead) => repos.saveLead(lead),
    addEvent: (leadId: string, event: { type: string; status: 'ok' | 'error' | 'skipped'; detail?: Record<string, unknown> }) =>
      repos.addEvent(leadId, event),
    findIdentity: (email?: string, phoneE164?: string) => repos.findIdentity(email, phoneE164),
    rememberIdentity: (email: string | undefined, phone: string | undefined, contactId: string, opportunityId?: string) =>
      repos.rememberIdentity(email, phone, contactId, opportunityId),
    saveSlots: (leadId: string, slots: string[]) => repos.saveSlots(leadId, slots),
  };
}
