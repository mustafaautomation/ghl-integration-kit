import { mkdirSync } from 'node:fs';
import path from 'node:path';
import cors from '@fastify/cors';
import type { Database } from '@ghl/db';
import {
  GhlAdapter,
  MetaLeadSource,
  NotInstalledError,
  newId,
  OAuthClient,
  QueueWorker,
  SqliteJobQueue,
  TokenService,
  WebsiteFormSource,
  LEADCONNECTOR_VERSION,
  bookSlot,
  buildInstallUrl,
  checkOauthState,
  checkTimestamp,
  contactsListSchema,
  createLogger,
  createOauthState,
  eventsListSchema,
  ghlFetch,
  headerMap,
  inspectionForRejection,
  isMissedCallEvent,
  isUninstallEvent,
  opportunitiesSearchSchema,
  parseEncryptionKey,
  parseMissedCall,
  readiness,
  runMissedCall,
  runSpeedToLead,
  sampleMetaLead,
  signMetaBody,
  verifyWebhookSignature,
  type AppLogger,
  type FlowDeps,
  type NormalizedLead,
} from '@ghl/domain';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import type postgres from 'postgres';
import { ZodError, z } from 'zod';
import type { AppConfig } from './config.js';
import { createBus, type LiveEvent } from './bus.js';
import { Repositories, flowLeadApi } from './repos.js';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string;
  }
}

export interface AppDeps {
  config: AppConfig;
  db: Database;
  sql: postgres.Sql;
  queue?: SqliteJobQueue;
  logger?: AppLogger;
}

const ghlEventSchema = z.object({
  type: z.string().optional(),
  webhookId: z.string().min(1),
  timestamp: z.string(),
  locationId: z.string().optional(),
  data: z.record(z.unknown()).optional(),
  messageType: z.string().optional(),
  status: z.string().optional(),
});

function flatHeaders(headers: FastifyRequest['headers']): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (key === 'authorization' || key === 'cookie') continue;
    out[key] = Array.isArray(value) ? value.join(',') : String(value);
  }
  return out;
}

function issues(error: ZodError) {
  return error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
}

export async function buildServer(deps: AppDeps) {
  const logger = deps.logger ?? createLogger(deps.config.logLevel);
  const queue =
    deps.queue ??
    SqliteJobQueue.open(deps.config.queueDbPath, {
      maxAttempts: deps.config.queueMaxAttempts,
      baseMs: deps.config.queueBaseMs,
      maxMs: deps.config.queueMaxMs,
      jitterRatio: deps.config.queueJitter,
    });
  const bus = createBus();
  const repos = new Repositories(deps.db, bus);
  const key = parseEncryptionKey(deps.config.tokenEncryptionKey);
  const oauth = new OAuthClient({
    tokenUrl: `${deps.config.ghlBaseUrl}/oauth/token`,
    clientId: deps.config.clientId,
    clientSecret: deps.config.clientSecret,
    redirectUri: deps.config.redirectUri,
    userType: deps.config.userType,
  });
  const tokens = new TokenService(repos, oauth, key, deps.config.refreshSkewMs);
  const crm = new GhlAdapter({
    baseUrl: deps.config.ghlBaseUrl,
    locationId: deps.config.locationId,
    fieldIds: deps.config.fieldIds,
    getToken: () => tokens.getValidAccessToken(deps.config.locationId),
  });
  const meta = new MetaLeadSource({
    appSecret: deps.config.metaAppSecret,
    verifyToken: deps.config.metaVerifyToken,
    fieldMap: deps.config.fieldMap,
  });
  const forms = new WebsiteFormSource({ secret: deps.config.formWebhookSecret, fieldMap: deps.config.fieldMap });
  const ctx: AppContext = {
    config: deps.config,
    db: deps.db,
    sql: deps.sql,
    queue,
    logger,
    bus,
    repos,
    oauth,
    tokens,
    crm,
    meta,
    forms,
  };

  const flow = (): FlowDeps => ({
    crm,
    leads: flowLeadApi(repos),
    log: logger,
    businessName: deps.config.businessName,
    pipelineId: deps.config.pipelineId,
    stageNew: deps.config.stageNew,
    stageBooked: deps.config.stageBooked,
    calendarId: deps.config.calendarId,
    timezone: deps.config.timezone,
  });

  const worker = new QueueWorker(
    queue,
    {
      'speed-to-lead': async (payload) => {
        const { leadId } = z.object({ leadId: z.string() }).parse(payload);
        await runSpeedToLead(flow(), leadId);
      },
      'book-appointment': async (payload) => {
        const { leadId, startTime } = z.object({ leadId: z.string(), startTime: z.string() }).parse(payload);
        await bookSlot(flow(), leadId, startTime);
      },
      'missed-call': async (payload) => {
        const { leadId } = z.object({ leadId: z.string() }).parse(payload);
        await runMissedCall(flow(), leadId);
      },
    },
    deps.config.queuePollMs,
  );

  const app = Fastify({
    loggerInstance: logger,
    bodyLimit: 256 * 1024,
    genReqId: () => newId('req'),
    requestIdHeader: 'x-correlation-id',
  });
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    const raw = typeof body === 'string' ? body : body.toString('utf8');
    req.rawBody = raw;
    if (!raw) {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(raw) as unknown);
    } catch {
      const error = new Error('invalid_json') as Error & { statusCode: number };
      error.statusCode = 400;
      done(error, undefined);
    }
  });
  await app.register(cors, { origin: deps.config.consoleOrigin });
  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-correlation-id', req.id);
  });

  app.get('/health', async () => ({ ok: true }));
  app.get('/ready', async (_req, reply) => {
    let database = false;
    try {
      await deps.sql`select 1`;
      database = true;
    } catch {
      database = false;
    }
    const body = readiness({ database, queue: true });
    return reply.code(body.ok ? 200 : 503).send(body);
  });

  app.get('/oauth/install', async (_req, reply) => {
    const created = createOauthState(new Date(), deps.config.stateTtlMs);
    await repos.insertState(created.state, created.expiresAt);
    const url = buildInstallUrl({
      authorizeUrl: deps.config.authorizeUrl,
      clientId: deps.config.clientId,
      redirectUri: deps.config.redirectUri,
      scopes: deps.config.scopes,
      state: created.state,
    });
    return reply.redirect(url);
  });

  app.get('/oauth/callback', async (req, reply) => {
    const query = z.object({ code: z.string().min(1), state: z.string().min(1) }).safeParse(req.query);
    if (!query.success) return reply.code(400).send({ error: 'missing_code_or_state' });
    const row = await repos.takeState(query.data.state);
    const verdict = checkOauthState(row, new Date());
    if (verdict !== 'ok') return reply.code(400).send({ error: `state_${verdict}` });
    await repos.markStateUsed(query.data.state, new Date());
    const tokensResponse = await oauth.exchange(query.data.code);
    await tokens.saveFromTokenResponse(tokensResponse, tokensResponse.locationId ?? deps.config.locationId);
    const next = new URL(deps.config.consoleOrigin);
    next.searchParams.set('installed', '1');
    return reply.redirect(next.toString());
  });

  app.post('/webhooks/ghl', async (req, reply) => {
    const raw = req.rawBody ?? '';
    const headers = flatHeaders(req.headers);
    const verification = verifyWebhookSignature(raw, req.headers, deps.config.keys);
    if (!verification.ok) {
      const record = inspectionForRejection({ source: 'ghl', rawBody: raw, headers, reason: verification.reason, statusCode: 401 });
      await repos.inspect(record);
      return reply.code(401).send({ statusCode: 401, error: 'invalid_signature', reason: verification.reason });
    }
    let json: unknown;
    try {
      json = JSON.parse(raw) as unknown;
    } catch {
      await repos.inspect({ source: 'ghl', eventId: null, signatureValid: true, idempotentHit: false, statusCode: 400, reason: 'invalid_json', rawBody: raw, headers });
      return reply.code(400).send({ statusCode: 400, error: 'invalid_json' });
    }
    const parsed = ghlEventSchema.safeParse(json);
    if (!parsed.success) {
      await repos.inspect({ source: 'ghl', eventId: null, signatureValid: true, idempotentHit: false, statusCode: 422, reason: 'invalid_payload', rawBody: raw, headers });
      return reply.code(422).send({ statusCode: 422, error: 'invalid_payload', issues: issues(parsed.error) });
    }
    const stamp = checkTimestamp(parsed.data.timestamp, new Date(), deps.config.timestampWindowMs);
    if (!stamp.ok) {
      await repos.inspect({
        source: 'ghl',
        eventId: parsed.data.webhookId,
        signatureValid: true,
        idempotentHit: false,
        statusCode: 401,
        reason: stamp.reason,
        rawBody: raw,
        headers,
      });
      return reply.code(401).send({ statusCode: 401, error: 'rejected_timestamp', reason: stamp.reason });
    }
    const inserted = await repos.tryInsertEvent(parsed.data.webhookId, 'ghl');
    if (inserted === 'duplicate') {
      await repos.inspect({
        source: 'ghl',
        eventId: parsed.data.webhookId,
        signatureValid: true,
        idempotentHit: true,
        statusCode: 200,
        reason: 'duplicate',
        rawBody: raw,
        headers,
      });
      return reply.send({ success: true, duplicate: true });
    }
    if (isUninstallEvent(parsed.data.type)) {
      const locationId = parsed.data.locationId ?? deps.config.locationId;
      await tokens.markUninstalled(locationId);
      await repos.inspect({ source: 'ghl', eventId: parsed.data.webhookId, signatureValid: true, idempotentHit: false, statusCode: 200, reason: 'uninstalled', rawBody: raw, headers });
      return reply.send({ success: true, uninstalled: true });
    }
    if (isMissedCallEvent(parsed.data)) {
      try {
        const lead = parseMissedCall(parsed.data.data ?? {}, new Date(), deps.config.fieldMap);
        const stored = await acceptLead(ctx, lead, json, 'ghl-webhook');
        ctx.queue.enqueue('missed-call', { leadId: stored.id }, { correlationId: stored.correlationId });
        await repos.inspect({ source: 'ghl', eventId: parsed.data.webhookId, signatureValid: true, idempotentHit: false, statusCode: 200, reason: 'missed_call', rawBody: raw, headers });
        return reply.send({ success: true, leadId: stored.id });
      } catch (error) {
        if (error instanceof ZodError) {
          await repos.inspect({ source: 'ghl', eventId: parsed.data.webhookId, signatureValid: true, idempotentHit: false, statusCode: 422, reason: 'invalid_payload', rawBody: raw, headers });
          return reply.code(422).send({ statusCode: 422, error: 'invalid_payload', issues: issues(error) });
        }
        throw error;
      }
    }
    await repos.inspect({
      source: 'ghl',
      eventId: parsed.data.webhookId,
      signatureValid: true,
      idempotentHit: false,
      statusCode: 200,
      reason: 'accepted',
      rawBody: raw,
      headers,
    });
    return reply.send({ success: true });
  });

  app.get('/webhooks/meta', async (req, reply) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(req.query as Record<string, unknown>)) {
      if (typeof value === 'string') query.set(key, value);
    }
    const result = meta.verifyHandshake(query);
    return reply.code(result.status).type('text/plain').send(result.body);
  });

  app.post('/webhooks/meta', async (req, reply) => {
    const raw = req.rawBody ?? '';
    const headers = flatHeaders(req.headers);
    const verification = meta.verify({ rawBody: raw, headers: headerMap(req.headers) });
    if (!verification.ok) {
      await repos.inspect(inspectionForRejection({ source: 'meta', rawBody: raw, headers, reason: verification.reason ?? 'mismatch', statusCode: 401 }));
      return reply.code(401).send({ statusCode: 401, error: 'invalid_signature', reason: verification.reason });
    }
    let json: unknown;
    try {
      json = JSON.parse(raw) as unknown;
    } catch {
      return reply.code(400).send({ statusCode: 400, error: 'invalid_json' });
    }
    try {
      const leads = meta.parse(json, new Date());
      const leadIds: string[] = [];
      let duplicate = false;
      for (const lead of leads) {
        const eventId = `meta:${lead.externalId}`;
        const inserted = await repos.tryInsertEvent(eventId, 'meta');
        if (inserted === 'duplicate') {
          duplicate = true;
          continue;
        }
        const stored = await acceptLead(ctx, lead, json, 'hmac-sha256');
        ctx.queue.enqueue('speed-to-lead', { leadId: stored.id }, { correlationId: stored.correlationId });
        leadIds.push(stored.id);
      }
      await repos.inspect({
        source: 'meta',
        eventId: leads[0]?.externalId ?? null,
        signatureValid: true,
        idempotentHit: duplicate && leadIds.length === 0,
        statusCode: 200,
        reason: duplicate && leadIds.length === 0 ? 'duplicate' : 'accepted',
        rawBody: raw,
        headers,
      });
      return reply.send({ success: true, leadIds, duplicate: duplicate && leadIds.length === 0 });
    } catch (error) {
      if (error instanceof ZodError) {
        await repos.inspect({ source: 'meta', eventId: null, signatureValid: true, idempotentHit: false, statusCode: 422, reason: 'invalid_payload', rawBody: raw, headers });
        return reply.code(422).send({ statusCode: 422, error: 'invalid_payload', issues: issues(error) });
      }
      throw error;
    }
  });

  app.post('/webhooks/forms', async (req, reply) => {
    const raw = req.rawBody ?? '';
    const headers = flatHeaders(req.headers);
    const verification = forms.verify({ rawBody: raw, headers: headerMap(req.headers) });
    if (!verification.ok) {
      await repos.inspect(inspectionForRejection({ source: 'website_form', rawBody: raw, headers, reason: verification.reason ?? 'mismatch', statusCode: 401 }));
      return reply.code(401).send({ statusCode: 401, error: 'invalid_signature', reason: verification.reason });
    }
    let json: unknown;
    try {
      json = JSON.parse(raw) as unknown;
    } catch {
      return reply.code(400).send({ statusCode: 400, error: 'invalid_json' });
    }
    const submittedAt = typeof json === 'object' && json && 'submittedAt' in json ? (json as { submittedAt?: unknown }).submittedAt : undefined;
    const stamp = checkTimestamp(submittedAt, new Date(), deps.config.timestampWindowMs);
    if (!stamp.ok) {
      await repos.inspect({ source: 'website_form', eventId: null, signatureValid: true, idempotentHit: false, statusCode: 401, reason: stamp.reason, rawBody: raw, headers });
      return reply.code(401).send({ statusCode: 401, error: 'rejected_timestamp', reason: stamp.reason });
    }
    try {
      const [lead] = forms.parse(json, new Date());
      if (!lead) return reply.code(422).send({ statusCode: 422, error: 'invalid_payload' });
      const inserted = await repos.tryInsertEvent(`form:${lead.externalId}`, 'website_form');
      if (inserted === 'duplicate') {
        await repos.inspect({ source: 'website_form', eventId: lead.externalId, signatureValid: true, idempotentHit: true, statusCode: 200, reason: 'duplicate', rawBody: raw, headers });
        return reply.send({ success: true, duplicate: true });
      }
      const stored = await acceptLead(ctx, lead, json, 'hmac-sha256');
      ctx.queue.enqueue('speed-to-lead', { leadId: stored.id }, { correlationId: stored.correlationId });
      await repos.inspect({ source: 'website_form', eventId: lead.externalId, signatureValid: true, idempotentHit: false, statusCode: 200, reason: 'accepted', rawBody: raw, headers });
      return reply.send({ success: true, leadId: stored.id });
    } catch (error) {
      if (error instanceof ZodError) {
        await repos.inspect({ source: 'website_form', eventId: null, signatureValid: true, idempotentHit: false, statusCode: 422, reason: 'invalid_payload', rawBody: raw, headers });
        return reply.code(422).send({ statusCode: 422, error: 'invalid_payload', issues: issues(error) });
      }
      throw error;
    }
  });

  app.post('/demo/test-lead', async (req, reply) => {
    if (deps.config.mode !== 'mock') return reply.code(404).send({ error: 'not_found' });
    const sample = sampleMetaLead(new Date());
    const raw = JSON.stringify(sample.raw);
    const address = app.server.address();
    const port = typeof address === 'object' && address ? address.port : deps.config.port;
    const res = await fetch(`http://127.0.0.1:${port}/webhooks/meta`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': signMetaBody(raw, deps.config.metaAppSecret),
      },
      body: raw,
    });
    const body = (await res.json()) as { leadIds?: string[]; error?: string };
    if (!res.ok || !body.leadIds?.[0]) {
      return reply.code(502).send({ error: 'demo_lead_failed', status: res.status, body });
    }
    return reply.code(202).send({ leadId: body.leadIds[0] });
  });

  app.post('/demo/reset', async (_req, reply) => {
    if (deps.config.mode !== 'mock') return reply.code(404).send({ error: 'not_found' });
    await deps.sql`TRUNCATE TABLE lead_events, offered_slots, leads, identities, webhook_inspections, webhook_events RESTART IDENTITY CASCADE`;
    queue.db.prepare('DELETE FROM jobs').run();
    await fetch(`${deps.config.ghlBaseUrl}/_debug/reset`, { method: 'POST' });
    return { ok: true };
  });

  app.get('/stats', async () => {
    const counts = await repos.stats();
    const dead = queue.list('dead', 100).length;
    return {
      ...counts,
      deadLetters: dead,
      mode: deps.config.mode,
      businessName: deps.config.businessName,
      locationId: deps.config.locationId,
    };
  });

  app.get('/leads', async () => ({ leads: await repos.listLeads() }));
  app.get('/leads/:id', async (req, reply) => {
    const params = z.object({ id: z.string() }).parse(req.params);
    const detail = await repos.detail(params.id);
    if (!detail) return reply.code(404).send({ error: 'not_found' });
    return detail;
  });

  app.post('/leads/:id/book', async (req, reply) => {
    const params = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({ startTime: z.string().min(1) }).parse(req.body);
    const detail = await repos.detail(params.id);
    if (!detail) return reply.code(404).send({ error: 'not_found' });
    if (!detail.slots.includes(body.startTime)) return reply.code(422).send({ error: 'unknown_slot' });
    const jobId = queue.enqueue('book-appointment', { leadId: params.id, startTime: body.startTime }, { correlationId: params.id });
    const job = await queue.wait(jobId, 8_000);
    if (job.status !== 'completed') return reply.code(502).send({ error: 'booking_failed', lastError: job.lastError });
    return repos.detail(params.id);
  });

  app.get('/inspections', async () => ({ inspections: await repos.listInspections() }));

  app.get('/crm/contacts', async (_req, reply) => proxyCrm(ctx, reply, '/contacts/', { locationId: deps.config.locationId }, contactsListSchema));
  app.get('/crm/opportunities', async (_req, reply) =>
    proxyCrm(ctx, reply, '/opportunities/search', { location_id: deps.config.locationId }, opportunitiesSearchSchema),
  );
  app.get('/crm/appointments', async (_req, reply) =>
    proxyCrm(ctx, reply, '/calendars/events', { locationId: deps.config.locationId, calendarId: deps.config.calendarId }, eventsListSchema),
  );

  app.get('/queue', async () => ({
    dead: queue.list('dead', 50),
    recent: queue.list(undefined, 50),
  }));

  app.get('/stream', async (req, reply) => {
    const query = z.object({ leadId: z.string().optional() }).parse(req.query);
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': deps.config.consoleOrigin,
      'X-Accel-Buffering': 'no',
    });
    const seen = new Set<number>();
    let ready = false;
    const pending: LiveEvent[] = [];
    const write = (event: LiveEvent) => {
      if (seen.has(event.id)) return;
      seen.add(event.id);
      reply.raw.write(`event: lead\ndata: ${JSON.stringify(event)}\n\n`);
    };
    const stop = bus.subscribe((event) => {
      if (query.leadId && event.leadId !== query.leadId) return;
      if (!ready) pending.push(event);
      else write(event);
    });
    const history = await repos.eventsFor(query.leadId);
    for (const event of query.leadId ? history : [...history].reverse()) write(event);
    ready = true;
    for (const event of pending) write(event);
    const heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), 15_000);
    const close = () => {
      clearInterval(heartbeat);
      stop();
    };
    req.raw.on('close', close);
  });

  app.setErrorHandler((error: Error & { statusCode?: number }, req, reply) => {
    if (error instanceof ZodError) {
      return reply.code(422).send({ statusCode: 422, error: 'invalid_payload', issues: issues(error) });
    }
    if (error instanceof NotInstalledError) {
      return reply.code(409).send({ error: 'not_installed' });
    }
    req.log.error({ errName: error.name, errMessage: error.message, correlationId: req.id }, 'request failed');
    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    return reply.code(status).send({ statusCode: status, error: status === 500 ? 'internal_error' : error.message });
  });

  return { app, worker, ctx };
}

export interface AppContext {
  config: AppConfig;
  db: Database;
  sql: postgres.Sql;
  queue: SqliteJobQueue;
  logger: AppLogger;
  bus: ReturnType<typeof createBus>;
  repos: Repositories;
  oauth: OAuthClient;
  tokens: TokenService;
  crm: GhlAdapter;
  meta: MetaLeadSource;
  forms: WebsiteFormSource;
}

async function acceptLead(ctx: AppContext, lead: NormalizedLead, raw: unknown, algorithm: string) {
  const stored = await ctx.repos.createLead(lead, raw);
  await ctx.repos.addEvent(stored.id, { type: 'received', status: 'ok', detail: { source: lead.source } });
  await ctx.repos.addEvent(stored.id, { type: 'verified', status: 'ok', detail: { algorithm } });
  return stored;
}

async function proxyCrm(ctx: AppContext, reply: FastifyReply, pathName: string, query: Record<string, string>, schema: z.ZodType<unknown>) {
  try {
    const token = await ctx.tokens.getValidAccessToken(ctx.config.locationId);
    const json = await ghlFetch(ctx.config.ghlBaseUrl, { method: 'GET', path: pathName, token, query });
    return schema.parse(json);
  } catch (error) {
    if (error instanceof NotInstalledError) return reply.code(409).send({ error: 'not_installed' });
    throw error;
  }
}

export async function ensureInstallation(ctx: AppContext): Promise<void> {
  if (ctx.config.mode !== 'mock') return;
  const existing = await ctx.repos.get(ctx.config.locationId);
  if (existing && !existing.uninstalledAt) {
    const healthy = await installationWorks(ctx).catch(() => false);
    if (healthy) return;
    await ctx.tokens.markUninstalled(ctx.config.locationId);
  }
  const created = createOauthState(new Date(), ctx.config.stateTtlMs);
  await ctx.repos.insertState(created.state, created.expiresAt);
  const authorize = new URL('/oauth/chooselocation', `${ctx.config.ghlBaseUrl}/`);
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('client_id', ctx.config.clientId);
  authorize.searchParams.set('redirect_uri', ctx.config.redirectUri);
  authorize.searchParams.set('scope', ctx.config.scopes.join(' '));
  authorize.searchParams.set('state', created.state);
  authorize.searchParams.set('format', 'json');
  const issued = await fetch(authorize);
  if (!issued.ok) throw new Error(`mock_install_failed_${issued.status}`);
  const body = z.object({ code: z.string() }).parse(await issued.json());
  const verdict = checkOauthState(await ctx.repos.takeState(created.state), new Date());
  if (verdict !== 'ok') throw new Error(`state_${verdict}`);
  await ctx.repos.markStateUsed(created.state, new Date());
  const tokens = await ctx.oauth.exchange(body.code);
  await ctx.tokens.saveFromTokenResponse(tokens, ctx.config.locationId);
}

async function installationWorks(ctx: AppContext): Promise<boolean> {
  const token = await ctx.tokens.getValidAccessToken(ctx.config.locationId);
  const res = await fetch(new URL(`/locations/${ctx.config.locationId}`, `${ctx.config.ghlBaseUrl}/`), {
    headers: {
      Authorization: `Bearer ${token}`,
      Version: LEADCONNECTOR_VERSION,
      Accept: 'application/json',
    },
  });
  return res.ok;
}

export function prepareQueuePath(file: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
}
