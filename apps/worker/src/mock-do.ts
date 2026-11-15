import { z } from 'zod';
import type { Env } from './env.js';

interface Contact {
  id: string;
  locationId: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  tags: string[];
  source?: string;
  customFields: Array<{ id: string; field_value: string }>;
  dateAdded: string;
  dateUpdated: string;
}

interface Opportunity {
  id: string;
  name: string;
  monetaryValue: number;
  pipelineId: string;
  pipelineStageId: string;
  status: string;
  contactId: string;
  locationId: string;
  source?: string;
}

interface Appointment {
  id: string;
  calendarId: string;
  locationId: string;
  contactId: string;
  title: string;
  startTime: string;
  endTime: string;
  appointmentStatus: string;
  status: string;
  assignedUserId: string;
  dateAdded: string;
  dateUpdated: string;
}

interface TokenRecord {
  accessToken: string;
  refreshToken: string;
  locationId: string;
  companyId: string;
  userId: string;
}

interface Snapshot {
  codes: Array<[string, { redirectUri: string; state: string }]>;
  access: Array<[string, TokenRecord]>;
  refresh: Array<[string, TokenRecord]>;
  contacts: Array<[string, Contact]>;
  opportunities: Array<[string, Opportunity]>;
  appointments: Array<[string, Appointment]>;
  failLeft: number;
  failRetryAfter: string;
  counters: {
    exchanges: number;
    refreshes: number;
    upserts: number;
    messages: number;
    opportunities: number;
    slots: number;
    appointments: number;
    rateLimits: number;
  };
}

const TRACE = 'trace_mock_555';
const SCOPE =
  'contacts.readonly contacts.write opportunities.readonly opportunities.write conversations.readonly conversations.write conversations/message.readonly conversations/message.write calendars.readonly calendars.write calendars/events.readonly calendars/events.write locations.readonly locations/customFields.readonly locations/tags.readonly';

function hex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((part) => part.toString(16).padStart(2, '0')).join('');
}

function id(prefix: string): string {
  return `${prefix}_${hex(4)}`;
}

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  const next = new Headers(headers);
  next.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(body), { status, headers: next });
}

function wallClockIso(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): string {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  let utc = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let i = 0; i < 4; i += 1) {
    const parts = Object.fromEntries(dtf.formatToParts(new Date(utc)).map((part) => [part.type, part.value]));
    const asUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
    const delta = desired - asUtc;
    if (delta === 0) break;
    utc += delta;
  }
  const offsetMin = Math.round((Date.UTC(year, month - 1, day, hour, minute, 0) - utc) / 60_000);
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

function addMinutes(iso: string, minutes: number): string {
  const ms = Date.parse(iso);
  const next = new Date(ms + minutes * 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const offset = iso.slice(-6);
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(offset);
  if (!match || !match[1] || !match[2] || !match[3]) return next.toISOString();
  const sign = match[1] === '-' ? -1 : 1;
  const offMin = sign * (Number(match[2]) * 60 + Number(match[3]));
  const wall = new Date(next.getTime() + offMin * 60_000);
  return `${wall.getUTCFullYear()}-${pad(wall.getUTCMonth() + 1)}-${pad(wall.getUTCDate())}T${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}:00${offset}`;
}

function emptySnapshot(): Snapshot {
  return {
    codes: [],
    access: [],
    refresh: [],
    contacts: [],
    opportunities: [],
    appointments: [],
    failLeft: 0,
    failRetryAfter: '1',
    counters: { exchanges: 0, refreshes: 0, upserts: 0, messages: 0, opportunities: 0, slots: 0, appointments: 0, rateLimits: 0 },
  };
}

class MockState {
  readonly codes = new Map<string, { redirectUri: string; state: string }>();
  readonly access = new Map<string, TokenRecord>();
  readonly refresh = new Map<string, TokenRecord>();
  readonly contacts = new Map<string, Contact>();
  readonly opportunities = new Map<string, Opportunity>();
  readonly appointments = new Map<string, Appointment>();
  failLeft = 0;
  failRetryAfter = '1';
  counters = emptySnapshot().counters;
  dirty = false;

  static from(raw: Snapshot | null): MockState {
    const state = new MockState();
    const snap = raw ?? emptySnapshot();
    for (const [key, value] of snap.codes) state.codes.set(key, value);
    for (const [key, value] of snap.access) state.access.set(key, value);
    for (const [key, value] of snap.refresh) state.refresh.set(key, value);
    for (const [key, value] of snap.contacts) state.contacts.set(key, value);
    for (const [key, value] of snap.opportunities) state.opportunities.set(key, value);
    for (const [key, value] of snap.appointments) state.appointments.set(key, value);
    state.failLeft = snap.failLeft;
    state.failRetryAfter = snap.failRetryAfter;
    state.counters = snap.counters;
    return state;
  }

  snapshot(): Snapshot {
    return {
      codes: [...this.codes],
      access: [...this.access],
      refresh: [...this.refresh],
      contacts: [...this.contacts],
      opportunities: [...this.opportunities],
      appointments: [...this.appointments],
      failLeft: this.failLeft,
      failRetryAfter: this.failRetryAfter,
      counters: this.counters,
    };
  }

  issueTokens(locationId: string, companyId: string, userId: string): TokenRecord {
    const record: TokenRecord = {
      accessToken: `at_${hex(12)}`,
      refreshToken: `rt_${hex(12)}`,
      locationId,
      companyId,
      userId,
    };
    this.access.set(record.accessToken, record);
    this.refresh.set(record.refreshToken, record);
    this.dirty = true;
    return record;
  }
}

function tokenBody(record: TokenRecord) {
  return {
    access_token: record.accessToken,
    token_type: 'Bearer' as const,
    expires_in: 86399,
    refresh_token: record.refreshToken,
    scope: SCOPE,
    userType: 'Location' as const,
    locationId: record.locationId,
    companyId: record.companyId,
    userId: record.userId,
  };
}

async function readBody(request: Request): Promise<unknown> {
  const type = request.headers.get('content-type') ?? '';
  if (type.includes('application/x-www-form-urlencoded')) {
    const form = await request.formData();
    return Object.fromEntries([...form].map(([key, value]) => [key, String(value)]));
  }
  const text = await request.text();
  if (!text) return {};
  return JSON.parse(text) as unknown;
}

export async function handleMockRequest(request: Request, state: MockState, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = (url.pathname.replace(/\/+$/, '') || '/');
  const clientId = env.GHL_CLIENT_ID || 'mock-client-id';
  const clientSecret = env.GHL_CLIENT_SECRET || 'mock-client-secret';
  const locationId = env.LOCATION_ID || 'loc_northwind_555';
  const companyId = env.COMPANY_ID || 'co_northwind_555';
  const userId = env.USER_ID || 'user_555';
  const locationName = env.BUSINESS_NAME || 'Northwind Studio';

  try {
    if (path === '/health' || path === '/_debug/counters') {
      if (path === '/health') return json({ ok: true });
      return json(state.counters);
    }
    if (path === '/_debug/fail' && request.method === 'POST') {
      const body = z.object({ count: z.number().int().positive(), retryAfterSeconds: z.number().nonnegative().default(1) }).parse(await readBody(request));
      state.failLeft = body.count;
      state.failRetryAfter = String(body.retryAfterSeconds);
      state.dirty = true;
      return json({ ok: true, count: state.failLeft });
    }
    if (path === '/_debug/reset' && request.method === 'POST') {
      state.contacts.clear();
      state.opportunities.clear();
      state.appointments.clear();
      state.failLeft = 0;
      state.dirty = true;
      return json({ ok: true });
    }

    if (!path.startsWith('/oauth')) {
      if (request.headers.get('x-mock-force-429') === '1') {
        state.counters.rateLimits += 1;
        state.dirty = true;
        return json({ statusCode: 429, message: 'Too Many Requests' }, 429, { 'Retry-After': '1' });
      }
      if (!request.headers.get('version')) {
        return json({ statusCode: 400, message: 'Version header is required' }, 400);
      }
      const header = request.headers.get('authorization') ?? '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : '';
      if (!token || !state.access.has(token)) {
        return json({ statusCode: 401, message: 'Invalid token' }, 401);
      }
      if (state.failLeft > 0) {
        state.failLeft -= 1;
        state.counters.rateLimits += 1;
        state.dirty = true;
        return json({ statusCode: 429, message: 'Too Many Requests' }, 429, { 'Retry-After': state.failRetryAfter });
      }
    }

    if (path === '/oauth/chooselocation' && request.method === 'GET') {
      const query = z
        .object({
          client_id: z.string(),
          redirect_uri: z.string().url(),
          state: z.string().min(1),
          response_type: z.string().optional(),
          scope: z.string().optional(),
          format: z.string().optional(),
        })
        .parse(Object.fromEntries(url.searchParams));
      if (query.client_id !== clientId) return json({ error: 'invalid_client' }, 401);
      const code = `code_${hex(8)}`;
      state.codes.set(code, { redirectUri: query.redirect_uri, state: query.state });
      state.dirty = true;
      if (query.format === 'json') return json({ code, state: query.state, locationId, companyId });
      const back = new URL(query.redirect_uri);
      back.searchParams.set('code', code);
      back.searchParams.set('state', query.state);
      const href = back.toString().replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);
      return new Response(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Install ${locationName}</title></head><body><main><h1>Install on ${locationName}</h1><p>This is the mock consent screen.</p><a href="${href}">Install ${locationName}</a></main></body></html>`,
        { headers: { 'content-type': 'text/html; charset=utf-8' } },
      );
    }

    if (path === '/oauth/token' && request.method === 'POST') {
      const body = z
        .object({
          client_id: z.string(),
          client_secret: z.string(),
          grant_type: z.enum(['authorization_code', 'refresh_token']),
          code: z.string().optional(),
          redirect_uri: z.string().optional(),
          refresh_token: z.string().optional(),
          user_type: z.string().optional(),
        })
        .parse(await readBody(request));
      if (body.client_id !== clientId || body.client_secret !== clientSecret) return json({ error: 'invalid_client' }, 401);
      if (body.grant_type === 'authorization_code') {
        const issued = body.code ? state.codes.get(body.code) : undefined;
        if (!issued || issued.redirectUri !== body.redirect_uri) return json({ error: 'invalid_grant' }, 400);
        state.codes.delete(body.code!);
        state.counters.exchanges += 1;
        state.dirty = true;
        return json(tokenBody(state.issueTokens(locationId, companyId, userId)));
      }
      const current = body.refresh_token ? state.refresh.get(body.refresh_token) : undefined;
      if (!current) return json({ error: 'invalid_grant' }, 400);
      state.access.delete(current.accessToken);
      state.refresh.delete(current.refreshToken);
      state.counters.refreshes += 1;
      state.dirty = true;
      return json(tokenBody(state.issueTokens(locationId, companyId, userId)));
    }

    if (request.method === 'GET' && path.startsWith('/locations/')) {
      const location = path.slice('/locations/'.length);
      return json({ location: { id: location, name: locationName, companyId, timezone: 'America/New_York' }, traceId: TRACE });
    }

    if (path === '/contacts/upsert' && request.method === 'POST') {
      const body = z
        .object({
          locationId: z.string(),
          firstName: z.string().optional(),
          lastName: z.string().optional(),
          email: z.string().optional(),
          phone: z.string().optional(),
          tags: z.array(z.string()).optional(),
          source: z.string().optional(),
          customFields: z.array(z.object({ id: z.string(), field_value: z.string() })).optional(),
        })
        .parse(await readBody(request));
      const email = body.email?.toLowerCase();
      const existing = [...state.contacts.values()].find(
        (contact) =>
          contact.locationId === body.locationId &&
          ((email && contact.email?.toLowerCase() === email) || (body.phone && contact.phone === body.phone)),
      );
      const now = new Date().toISOString();
      const contact: Contact = {
        id: existing?.id ?? id('contact'),
        locationId: body.locationId,
        firstName: body.firstName,
        lastName: body.lastName,
        email: body.email,
        phone: body.phone,
        tags: body.tags ?? [],
        source: body.source,
        customFields: body.customFields ?? [],
        dateAdded: existing?.dateAdded ?? now,
        dateUpdated: now,
      };
      state.contacts.set(contact.id, contact);
      state.counters.upserts += 1;
      state.dirty = true;
      return json({ new: !existing, contact, traceId: TRACE });
    }

    if (path === '/contacts' && request.method === 'GET') {
      const location = url.searchParams.get('locationId');
      const list = [...state.contacts.values()].filter((contact) => !location || contact.locationId === location);
      return json({
        contacts: list,
        meta: { total: list.length, nextPageUrl: null, startAfterId: null, startAfter: null, currentPage: 1, nextPage: null, prevPage: null },
        traceId: TRACE,
      });
    }

    if (request.method === 'GET' && path.startsWith('/contacts/')) {
      const contact = state.contacts.get(path.slice('/contacts/'.length));
      if (!contact) return json({ statusCode: 404, message: 'Contact not found' }, 404);
      return json({ contact, traceId: TRACE });
    }

    if (path === '/conversations/messages' && request.method === 'POST') {
      const body = z
        .object({
          type: z.enum(['SMS', 'Email']),
          contactId: z.string(),
          locationId: z.string(),
          message: z.string().optional(),
          html: z.string().optional(),
          subject: z.string().optional(),
        })
        .parse(await readBody(request));
      if (!state.contacts.has(body.contactId)) return json({ statusCode: 404, message: 'Contact not found' }, 404);
      state.counters.messages += 1;
      state.dirty = true;
      const messageId = id(body.type === 'Email' ? 'emsg' : 'msg');
      return json({
        conversationId: `conv_${body.contactId}`,
        messageId,
        emailMessageId: body.type === 'Email' ? messageId : null,
        messageIds: [messageId],
        msg: 'queued',
        traceId: TRACE,
      });
    }

    if (path === '/opportunities' && request.method === 'POST') {
      const body = z
        .object({
          locationId: z.string(),
          pipelineId: z.string(),
          pipelineStageId: z.string(),
          name: z.string(),
          status: z.string(),
          contactId: z.string(),
          monetaryValue: z.number().optional(),
          source: z.string().optional(),
        })
        .parse(await readBody(request));
      const opportunity: Opportunity = {
        id: id('opp'),
        name: body.name,
        monetaryValue: body.monetaryValue ?? 0,
        pipelineId: body.pipelineId,
        pipelineStageId: body.pipelineStageId,
        status: body.status,
        contactId: body.contactId,
        locationId: body.locationId,
        source: body.source,
      };
      state.opportunities.set(opportunity.id, opportunity);
      state.counters.opportunities += 1;
      state.dirty = true;
      return json({ opportunity, traceId: TRACE });
    }

    if (path === '/opportunities/search' && request.method === 'GET') {
      const location = url.searchParams.get('location_id');
      const list = [...state.opportunities.values()].filter((row) => !location || row.locationId === location);
      return json({
        opportunities: list,
        meta: { total: list.length, nextPageUrl: null, startAfterId: null, startAfter: null, currentPage: 1, nextPage: null, prevPage: null },
        traceId: TRACE,
      });
    }

    if (request.method === 'PUT' && path.startsWith('/opportunities/')) {
      const current = state.opportunities.get(path.slice('/opportunities/'.length));
      if (!current) return json({ statusCode: 404, message: 'Opportunity not found' }, 404);
      const body = z.object({ pipelineStageId: z.string(), status: z.string().optional() }).parse(await readBody(request));
      const opportunity = { ...current, pipelineStageId: body.pipelineStageId, status: body.status ?? current.status };
      state.opportunities.set(opportunity.id, opportunity);
      state.dirty = true;
      return json({ opportunity, traceId: TRACE });
    }

    const slots = /^\/calendars\/([^/]+)\/free-slots$/.exec(path);
    if (slots && request.method === 'GET' && slots[1]) {
      const query = z
        .object({
          startDate: z.coerce.number(),
          endDate: z.coerce.number(),
          timezone: z.string().default('America/New_York'),
        })
        .parse({
          startDate: url.searchParams.get('startDate'),
          endDate: url.searchParams.get('endDate'),
          timezone: url.searchParams.get('timezone') ?? undefined,
        });
      if (query.endDate - query.startDate > 31 * 86_400_000) {
        return json({ statusCode: 422, message: 'Date range cannot be more than 31 days' }, 422);
      }
      state.counters.slots += 1;
      state.dirty = true;
      const calendarId = slots[1];
      const booked = new Set([...state.appointments.values()].filter((row) => row.calendarId === calendarId).map((row) => row.startTime));
      const body: Record<string, unknown> = { traceId: TRACE };
      const cursor = new Date(query.startDate);
      const end = new Date(query.endDate);
      const hours: Array<[number, number]> = [
        [10, 0],
        [11, 30],
        [14, 0],
        [15, 30],
      ];
      while (cursor <= end) {
        const parts = Object.fromEntries(
          new Intl.DateTimeFormat('en-US', { timeZone: query.timezone, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit' })
            .formatToParts(cursor)
            .map((part) => [part.type, part.value]),
        );
        const year = Number(parts.year);
        const month = Number(parts.month);
        const day = Number(parts.day);
        const key = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        if (parts.weekday !== 'Sat' && parts.weekday !== 'Sun' && !body[key]) {
          const times = hours
            .map(([hour, minute]) => wallClockIso(year, month, day, hour, minute, query.timezone))
            .filter((slot) => !booked.has(slot) && Date.parse(slot) >= query.startDate);
          if (times.length) body[key] = { slots: times };
        }
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
      return json(body);
    }

    if (path === '/calendars/events/appointments' && request.method === 'POST') {
      const body = z
        .object({
          calendarId: z.string(),
          locationId: z.string(),
          contactId: z.string(),
          startTime: z.string(),
          title: z.string(),
          appointmentStatus: z.string().optional(),
        })
        .parse(await readBody(request));
      if (!state.contacts.has(body.contactId)) return json({ statusCode: 404, message: 'Contact not found' }, 404);
      const taken = [...state.appointments.values()].some((row) => row.calendarId === body.calendarId && row.startTime === body.startTime);
      if (taken) return json({ statusCode: 409, message: 'Slot already booked' }, 409);
      const now = new Date().toISOString();
      const appointment: Appointment = {
        id: id('appt'),
        calendarId: body.calendarId,
        locationId: body.locationId,
        contactId: body.contactId,
        title: body.title,
        startTime: body.startTime,
        endTime: addMinutes(body.startTime, 30),
        appointmentStatus: body.appointmentStatus ?? 'confirmed',
        status: 'booked',
        assignedUserId: userId,
        dateAdded: now,
        dateUpdated: now,
      };
      state.appointments.set(appointment.id, appointment);
      state.counters.appointments += 1;
      state.dirty = true;
      return json(appointment);
    }

    if (path === '/calendars/events' && request.method === 'GET') {
      const location = url.searchParams.get('locationId');
      const calendar = url.searchParams.get('calendarId');
      const events = [...state.appointments.values()].filter((row) => {
        if (location && row.locationId !== location) return false;
        if (calendar && row.calendarId !== calendar) return false;
        return true;
      });
      return json({ events, traceId: TRACE });
    }

    return json({ statusCode: 404, message: 'Not found' }, 404);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return json({ statusCode: 422, message: 'Invalid payload', issues: error.issues }, 422);
    }
    if (error instanceof SyntaxError) return json({ statusCode: 400, message: 'Invalid JSON' }, 400);
    const message = error instanceof Error ? error.message : 'error';
    return json({ statusCode: 500, message }, 500);
  }
}

export class MockGhl implements DurableObject {
  private state: MockState | null = null;

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env,
  ) {}

  private async load(): Promise<MockState> {
    if (this.state) return this.state;
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS snapshot (id INTEGER PRIMARY KEY CHECK (id = 1), body TEXT NOT NULL)');
    const rows = this.ctx.storage.sql.exec('SELECT body FROM snapshot WHERE id = 1').toArray() as Array<{ body: string }>;
    const first = rows[0];
    this.state = MockState.from(first ? (JSON.parse(first.body) as Snapshot) : null);
    return this.state;
  }

  private persist(state: MockState): void {
    if (!state.dirty) return;
    this.ctx.storage.sql.exec(
      'INSERT INTO snapshot (id, body) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET body = excluded.body',
      JSON.stringify(state.snapshot()),
    );
    state.dirty = false;
  }

  async fetch(request: Request): Promise<Response> {
    const state = await this.load();
    const response = await handleMockRequest(request, state, this.env);
    this.persist(state);
    return response;
  }
}
