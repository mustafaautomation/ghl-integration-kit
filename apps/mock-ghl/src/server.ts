import { randomBytes } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';

export interface MockOptions {
  port?: number;
  host?: string;
  clientId?: string;
  clientSecret?: string;
  locationId?: string;
  companyId?: string;
  userId?: string;
  locationName?: string;
}

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

const TRACE = 'trace_mock_555';

function id(prefix: string): string {
  return `${prefix}_${randomBytes(4).toString('hex')}`;
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
  const shifted = new Date(next.getTime());
  // Keep the original offset by formatting the UTC instant plus that offset.
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(offset);
  if (!match) return next.toISOString();
  const sign = match[1] === '-' ? -1 : 1;
  const offMin = sign * (Number(match[2]) * 60 + Number(match[3]));
  const wall = new Date(shifted.getTime() + offMin * 60_000);
  return `${wall.getUTCFullYear()}-${pad(wall.getUTCMonth() + 1)}-${pad(wall.getUTCDate())}T${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}:00${offset}`;
}

export function buildMock(opts: MockOptions = {}): FastifyInstance {
  const clientId = opts.clientId ?? 'mock-client-id';
  const clientSecret = opts.clientSecret ?? 'mock-client-secret';
  const locationId = opts.locationId ?? 'loc_northwind_555';
  const companyId = opts.companyId ?? 'co_northwind_555';
  const userId = opts.userId ?? 'user_555';
  const locationName = opts.locationName ?? 'Northwind Studio';

  const codes = new Map<string, { redirectUri: string; state: string }>();
  const access = new Map<string, TokenRecord>();
  const refresh = new Map<string, TokenRecord>();
  const contacts = new Map<string, Contact>();
  const opportunities = new Map<string, Opportunity>();
  const appointments = new Map<string, Appointment>();
  const counters = {
    exchanges: 0,
    refreshes: 0,
    upserts: 0,
    messages: 0,
    opportunities: 0,
    slots: 0,
    appointments: 0,
    rateLimits: 0,
  };

  const app = Fastify({
    logger: false,
    routerOptions: { ignoreTrailingSlash: true },
  });

  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    const text = typeof body === 'string' ? body : body.toString('utf8');
    done(null, Object.fromEntries(new URLSearchParams(text)));
  });

  function issueTokens(): TokenRecord {
    const record: TokenRecord = {
      accessToken: `at_${randomBytes(12).toString('hex')}`,
      refreshToken: `rt_${randomBytes(12).toString('hex')}`,
      locationId,
      companyId,
      userId,
    };
    access.set(record.accessToken, record);
    refresh.set(record.refreshToken, record);
    return record;
  }

  function tokenBody(record: TokenRecord) {
    return {
      access_token: record.accessToken,
      token_type: 'Bearer' as const,
      expires_in: 86399,
      refresh_token: record.refreshToken,
      scope:
        'contacts.readonly contacts.write opportunities.readonly opportunities.write conversations.readonly conversations.write conversations/message.readonly conversations/message.write calendars.readonly calendars.write calendars/events.readonly calendars/events.write locations.readonly locations/customFields.readonly locations/tags.readonly',
      userType: 'Location' as const,
      locationId: record.locationId,
      companyId: record.companyId,
      userId: record.userId,
    };
  }

  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0] ?? '';
    if (path.startsWith('/oauth') || path.startsWith('/_debug')) return;
    if (req.headers['x-mock-force-429'] === '1') {
      counters.rateLimits += 1;
      return reply.code(429).header('Retry-After', '1').send({ statusCode: 429, message: 'Too Many Requests' });
    }
    if (!req.headers.version) {
      return reply.code(400).send({ statusCode: 400, message: 'Version header is required' });
    }
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token || !access.has(token)) {
      return reply.code(401).send({ statusCode: 401, message: 'Invalid token' });
    }
    reply.header('X-RateLimit-Limit-10s', '100');
    reply.header('X-RateLimit-Remaining-10s', '99');
    reply.header('X-RateLimit-Limit-Daily', '200000');
    reply.header('X-RateLimit-Remaining-Daily', '199999');
  });

  app.get('/oauth/chooselocation', async (req, reply) => {
    const query = z
      .object({
        client_id: z.string(),
        redirect_uri: z.string().url(),
        state: z.string().min(1),
        response_type: z.string().optional(),
        scope: z.string().optional(),
        format: z.string().optional(),
      })
      .parse(req.query);
    if (query.client_id !== clientId) {
      return reply.code(401).send({ error: 'invalid_client' });
    }
    const code = `code_${randomBytes(8).toString('hex')}`;
    codes.set(code, { redirectUri: query.redirect_uri, state: query.state });
    if (query.format === 'json') {
      return { code, state: query.state, locationId, companyId };
    }
    const back = new URL(query.redirect_uri);
    back.searchParams.set('code', code);
    back.searchParams.set('state', query.state);
    const href = back.toString().replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);
    return reply.type('text/html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Install Northwind</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #09090b; color: #f4f4f5; font: 16px/1.5 "Segoe UI", sans-serif; }
  main { width: min(420px, calc(100% - 32px)); border: 1px solid rgba(255,255,255,.1); border-radius: 16px; padding: 28px; background: #111216; }
  a { display: inline-block; margin-top: 16px; background: #f4f4f5; color: #111; text-decoration: none; border-radius: 999px; padding: 10px 16px; font-weight: 600; }
  p { color: #b7b7c2; }
</style></head>
<body><main>
  <h1>Install on ${locationName}</h1>
  <p>This is the mock consent screen. It grants the sample location and sends you back with a code.</p>
  <a href="${href}">Install ${locationName}</a>
</main></body></html>`);
  });

  app.post('/oauth/token', async (req, reply) => {
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
      .parse(req.body);
    if (body.client_id !== clientId || body.client_secret !== clientSecret) {
      return reply.code(401).send({ error: 'invalid_client' });
    }
    if (body.grant_type === 'authorization_code') {
      const issued = body.code ? codes.get(body.code) : undefined;
      if (!issued || issued.redirectUri !== body.redirect_uri) {
        return reply.code(400).send({ error: 'invalid_grant' });
      }
      codes.delete(body.code!);
      counters.exchanges += 1;
      return tokenBody(issueTokens());
    }
    const current = body.refresh_token ? refresh.get(body.refresh_token) : undefined;
    if (!current) return reply.code(400).send({ error: 'invalid_grant' });
    access.delete(current.accessToken);
    refresh.delete(current.refreshToken);
    counters.refreshes += 1;
    return tokenBody(issueTokens());
  });

  app.get('/locations/:locationId', async (req) => {
    const params = z.object({ locationId: z.string() }).parse(req.params);
    return {
      location: {
        id: params.locationId,
        name: locationName,
        companyId,
        timezone: 'America/New_York',
      },
      traceId: TRACE,
    };
  });

  app.post('/contacts/upsert', async (req, reply) => {
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
      .parse(req.body);
    const email = body.email?.toLowerCase();
    const existing = [...contacts.values()].find(
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
    contacts.set(contact.id, contact);
    counters.upserts += 1;
    return reply.send({ new: !existing, contact, traceId: TRACE });
  });

  app.get('/contacts/', async (req) => {
    const query = z.object({ locationId: z.string().optional() }).parse(req.query);
    const list = [...contacts.values()].filter((contact) => !query.locationId || contact.locationId === query.locationId);
    return {
      contacts: list,
      meta: { total: list.length, nextPageUrl: null, startAfterId: null, startAfter: null, currentPage: 1, nextPage: null, prevPage: null },
      traceId: TRACE,
    };
  });

  app.get('/contacts/:contactId', async (req, reply) => {
    const params = z.object({ contactId: z.string() }).parse(req.params);
    const contact = contacts.get(params.contactId);
    if (!contact) return reply.code(404).send({ statusCode: 404, message: 'Contact not found' });
    return { contact, traceId: TRACE };
  });

  app.post('/conversations/messages', async (req, reply) => {
    const body = z
      .object({
        type: z.enum(['SMS', 'Email']),
        contactId: z.string(),
        locationId: z.string(),
        message: z.string().optional(),
        html: z.string().optional(),
        subject: z.string().optional(),
      })
      .parse(req.body);
    if (!contacts.has(body.contactId)) return reply.code(404).send({ statusCode: 404, message: 'Contact not found' });
    counters.messages += 1;
    const messageId = id(body.type === 'Email' ? 'emsg' : 'msg');
    return {
      conversationId: `conv_${body.contactId}`,
      messageId,
      emailMessageId: body.type === 'Email' ? messageId : null,
      messageIds: [messageId],
      msg: 'queued',
      traceId: TRACE,
    };
  });

  app.post('/opportunities/', async (req) => {
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
      .parse(req.body);
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
    opportunities.set(opportunity.id, opportunity);
    counters.opportunities += 1;
    return { opportunity, traceId: TRACE };
  });

  app.put('/opportunities/:id', async (req, reply) => {
    const params = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({ pipelineStageId: z.string(), status: z.string().optional() }).parse(req.body);
    const current = opportunities.get(params.id);
    if (!current) return reply.code(404).send({ statusCode: 404, message: 'Opportunity not found' });
    const opportunity = { ...current, pipelineStageId: body.pipelineStageId, status: body.status ?? current.status };
    opportunities.set(opportunity.id, opportunity);
    return { opportunity, traceId: TRACE };
  });

  app.get('/opportunities/search', async (req) => {
    const query = z.object({ location_id: z.string().optional() }).parse(req.query);
    const list = [...opportunities.values()].filter((row) => !query.location_id || row.locationId === query.location_id);
    return {
      opportunities: list,
      meta: { total: list.length, nextPageUrl: null, startAfterId: null, startAfter: null, currentPage: 1, nextPage: null, prevPage: null },
      traceId: TRACE,
    };
  });

  app.get('/calendars/:calendarId/free-slots', async (req, reply) => {
    const params = z.object({ calendarId: z.string() }).parse(req.params);
    const query = z
      .object({
        startDate: z.coerce.number(),
        endDate: z.coerce.number(),
        timezone: z.string().default('America/New_York'),
      })
      .parse(req.query);
    if (query.endDate - query.startDate > 31 * 86_400_000) {
      return reply.code(422).send({ statusCode: 422, message: 'Date range cannot be more than 31 days' });
    }
    counters.slots += 1;
    const booked = new Set(
      [...appointments.values()].filter((row) => row.calendarId === params.calendarId).map((row) => row.startTime),
    );
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
        new Intl.DateTimeFormat('en-US', {
          timeZone: query.timezone,
          weekday: 'short',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        })
          .formatToParts(cursor)
          .map((part) => [part.type, part.value]),
      );
      const weekday = parts.weekday;
      const year = Number(parts.year);
      const month = Number(parts.month);
      const day = Number(parts.day);
      const key = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (weekday !== 'Sat' && weekday !== 'Sun' && !body[key]) {
        const slots = hours
          .map(([hour, minute]) => wallClockIso(year, month, day, hour, minute, query.timezone))
          .filter((slot) => !booked.has(slot) && Date.parse(slot) >= query.startDate);
        if (slots.length) body[key] = { slots };
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return body;
  });

  app.post('/calendars/events/appointments', async (req, reply) => {
    const body = z
      .object({
        calendarId: z.string(),
        locationId: z.string(),
        contactId: z.string(),
        startTime: z.string(),
        title: z.string(),
        appointmentStatus: z.string().optional(),
      })
      .parse(req.body);
    if (!contacts.has(body.contactId)) return reply.code(404).send({ statusCode: 404, message: 'Contact not found' });
    const taken = [...appointments.values()].some((row) => row.calendarId === body.calendarId && row.startTime === body.startTime);
    if (taken) return reply.code(409).send({ statusCode: 409, message: 'Slot already booked' });
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
    appointments.set(appointment.id, appointment);
    counters.appointments += 1;
    return appointment;
  });

  app.get('/calendars/events', async (req) => {
    const query = z
      .object({
        locationId: z.string().optional(),
        calendarId: z.string().optional(),
      })
      .parse(req.query);
    const events = [...appointments.values()].filter((row) => {
      if (query.locationId && row.locationId !== query.locationId) return false;
      if (query.calendarId && row.calendarId !== query.calendarId) return false;
      return true;
    });
    return { events, traceId: TRACE };
  });

  app.get('/_debug/counters', async () => counters);

  app.post('/_debug/reset', async () => {
    contacts.clear();
    opportunities.clear();
    appointments.clear();
    return { ok: true };
  });

  app.setErrorHandler((error: Error & { statusCode?: number }, _req: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof z.ZodError) {
      return reply.code(422).send({ statusCode: 422, message: 'Invalid payload', issues: error.issues });
    }
    return reply.code(error.statusCode ?? 500).send({ statusCode: error.statusCode ?? 500, message: error.message });
  });

  return app;
}

export async function startMock(opts: MockOptions = {}): Promise<{ app: FastifyInstance; url: string }> {
  const app = buildMock(opts);
  const host = opts.host ?? '0.0.0.0';
  await app.listen({ port: opts.port ?? 4100, host });
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : (opts.port ?? 4100);
  const hostName = host === '0.0.0.0' ? '127.0.0.1' : host;
  return { app, url: `http://${hostName}:${port}` };
}
