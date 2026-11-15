import { D1Store } from '@ghl/db/d1';
import {
  DEFAULT_SCOPES,
  NotInstalledError,
  OAUTH_AUTHORIZE_URL,
  bucketHours,
  buildInstallUrl,
  checkOauthState,
  checkTimestamp,
  contactsListSchema,
  createOauthState,
  eventsListSchema,
  ghlFetch,
  headerMap,
  inspectionForRejection,
  isMissedCallEvent,
  isUninstallEvent,
  opportunitiesSearchSchema,
  parseMissedCall,
  readiness,
  sampleMetaLead,
  signMetaBody,
  verifyWebhookSignature,
  type NormalizedLead,
} from '@ghl/domain/edge';
import { Hono } from 'hono';
import { z, ZodError } from 'zod';
import type { Env } from './env.js';
import { runJob } from './jobs.js';
import { locationFromInstall, metaAppSecret } from './live.js';
import { baseUrl, createServices, ensureInstalled, isMock, resetInstallCache, resolveLocationId, webhookKeys, type Services } from './runtime.js';

const ghlEventSchema = z.object({
  type: z.string().optional(),
  webhookId: z.string().min(1),
  timestamp: z.string(),
  locationId: z.string().optional(),
  data: z.record(z.unknown()).optional(),
  messageType: z.string().optional(),
  status: z.string().optional(),
});

function issues(error: ZodError) {
  return error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
}

function flatHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    if (key === 'authorization' || key === 'cookie') return;
    out[key] = value;
  });
  return out;
}

async function acceptLead(services: Services, lead: NormalizedLead, raw: unknown, algorithm: string) {
  const stored = await services.store.createLead(lead, raw);
  await services.store.addEvent(stored.id, { type: 'received', status: 'ok', detail: { source: lead.source } });
  await services.store.addEvent(stored.id, { type: 'verified', status: 'ok', detail: { algorithm } });
  return stored;
}

export function createApp() {
  const app = new Hono<{ Bindings: Env }>();

  app.get('/health', (c) => c.json({ ok: true }));

  app.get('/ready', async (c) => {
    const store = new D1Store(c.env.DB);
    const database = await store.ping().catch(() => false);
    const body = readiness({ database, queue: true });
    return c.json(body, body.ok ? 200 : 503);
  });

  app.use('*', async (c, next) => {
    if (c.req.path === '/health' || c.req.path === '/ready') return next();
    await ensureInstalled(c.env);
    return next();
  });

  app.get('/oauth/install', async (c) => {
    const services = createServices(c.env);
    const origin = new URL(c.req.url).origin;
    const created = createOauthState(new Date(), 600_000);
    await services.store.insertState(created.state, created.expiresAt);
    const url = buildInstallUrl({
      authorizeUrl: isMock(c.env) ? `${origin}/mock/oauth/chooselocation` : c.env.GHL_OAUTH_AUTHORIZE_URL || OAUTH_AUTHORIZE_URL,
      clientId: services.clientId,
      redirectUri: services.redirectUri,
      scopes: [...DEFAULT_SCOPES],
      state: created.state,
    });
    return c.redirect(url, 302);
  });

  app.get('/oauth/callback', async (c) => {
    const services = createServices(c.env);
    const origin = new URL(c.req.url).origin;
    const query = z.object({ code: z.string().min(1), state: z.string().min(1) }).safeParse({
      code: c.req.query('code'),
      state: c.req.query('state'),
    });
    if (!query.success) return c.json({ error: 'missing_code_or_state' }, 400);
    const row = await services.store.takeState(query.data.state);
    const verdict = checkOauthState(row, new Date());
    if (verdict !== 'ok') return c.json({ error: `state_${verdict}` }, 400);
    await services.store.markStateUsed(query.data.state, new Date());
    const exchanged = await services.oauth.exchange(query.data.code);
    await services.tokens.saveFromTokenResponse(exchanged, locationFromInstall(exchanged.locationId, c.env.LOCATION_ID));
    return c.redirect(`${origin}/?installed=1`, 302);
  });

  app.post('/webhooks/ghl', async (c) => handleGhl(c.env, await readRaw(c), c.executionCtx));
  app.get('/webhooks/meta', (c) => {
    const services = createServices(c.env);
    const result = services.meta.verifyHandshake(new URL(c.req.url).searchParams);
    return c.text(result.body, result.status as 200);
  });
  app.post('/webhooks/meta', async (c) => handleMeta(c.env, await readRaw(c), c.executionCtx));
  app.post('/webhooks/forms', async (c) => handleForm(c.env, await readRaw(c), c.executionCtx));

  app.post('/demo/test-lead', async (c) => {
    if (!isMock(c.env)) return c.json({ error: 'not_found' }, 404);
    const sample = sampleMetaLead(new Date());
    const raw = JSON.stringify(sample.raw);
    const result = await handleMeta(
      c.env,
      { raw, headers: { 'content-type': 'application/json', 'x-hub-signature-256': signMetaBody(raw, metaAppSecret(c.env)) } },
      c.executionCtx,
    );
    const body = (await result.json()) as { leadIds?: string[] };
    const leadId = body.leadIds?.[0];
    if (!result.ok || !leadId) return c.json({ error: 'demo_lead_failed', status: result.status, body }, 502);
    return c.json({ leadId }, 202);
  });

  app.post('/demo/reset', async (c) => {
    if (!isMock(c.env)) return c.json({ error: 'not_found' }, 404);
    await resetDemo(c.env);
    return c.json({ ok: true });
  });

  app.post('/demo/fail-outbound', async (c) => {
    if (!isMock(c.env)) return c.json({ error: 'not_found' }, 404);
    const services = createServices(c.env);
    const body = z
      .object({
        failures: z.number().int().positive().max(8).default(1),
        retryAfterSeconds: z.number().nonnegative().default(1),
        maxAttempts: z.number().int().positive().max(8).optional(),
      })
      .parse(await c.req.json().catch(() => ({})));
    const armed = await services.fetchImpl('https://mock.internal/_debug/fail', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: body.failures, retryAfterSeconds: body.retryAfterSeconds }),
    });
    if (!armed.ok) return c.json({ error: 'mock_unavailable' }, 502);
    const jobId = await services.queue.enqueue('ghl-probe', { purpose: 'rate-limit-demo' }, {
      maxAttempts: body.maxAttempts ?? Math.max(body.failures + 1, 2),
      correlationId: 'probe',
    });
    c.executionCtx.waitUntil(runJob(c.env, jobId));
    return c.json({ jobId }, 202);
  });

  app.get('/stats', async (c) => {
    const services = createServices(c.env);
    const counts = await services.store.stats();
    const stamps = await services.store.activityStamps();
    const now = new Date();
    const deadJobs = await services.queue.list('dead', 100);
    return c.json({
      ...counts,
      deadLetters: deadJobs.length,
      series: {
        leads: bucketHours(stamps.leads, now),
        messages: bucketHours(stamps.messages, now),
        booked: bucketHours(stamps.booked, now),
        deadLetters: bucketHours(
          deadJobs.map((job) => new Date(job.updatedAt)),
          now,
        ),
      },
      mode: isMock(c.env) ? 'mock' : 'live',
      businessName: c.env.BUSINESS_NAME,
      locationId: await resolveLocationId(c.env, services.store),
    });
  });

  app.get('/leads', async (c) => c.json({ leads: await createServices(c.env).store.listLeads() }));

  app.get('/leads/:id', async (c) => {
    const detail = await createServices(c.env).store.detail(c.req.param('id'));
    if (!detail) return c.json({ error: 'not_found' }, 404);
    return c.json(detail);
  });

  app.post('/leads/:id/book', async (c) => {
    const services = createServices(c.env);
    const id = c.req.param('id');
    const body = z.object({ startTime: z.string().min(1) }).parse(await c.req.json());
    const detail = await services.store.detail(id);
    if (!detail) return c.json({ error: 'not_found' }, 404);
    if (!detail.slots.includes(body.startTime)) return c.json({ error: 'unknown_slot' }, 422);
    const jobId = await services.queue.enqueue('book-appointment', { leadId: id, startTime: body.startTime }, { correlationId: id });
    const result = await runJob(c.env, jobId);
    if (result !== 'done') return c.json({ error: 'booking_failed' }, 502);
    return c.json(await services.store.detail(id));
  });

  app.get('/inspections', async (c) => {
    const rows = await createServices(c.env).store.listInspections();
    return c.json({
      inspections: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
    });
  });

  app.get('/crm/contacts', (c) => proxyCrm(c.env, '/contacts/', { locationId: '' }, contactsListSchema));
  app.get('/crm/opportunities', (c) => proxyCrm(c.env, '/opportunities/search', { location_id: '' }, opportunitiesSearchSchema));
  app.get('/crm/appointments', (c) =>
    proxyCrm(c.env, '/calendars/events', { locationId: '', calendarId: c.env.CALENDAR_ID }, eventsListSchema),
  );
  app.get('/offers', async (c) => c.json({ offers: await createServices(c.env).store.openOffers() }));
  app.get('/queue', async (c) => {
    const queue = createServices(c.env).queue;
    return c.json({ dead: await queue.list('dead', 50), recent: await queue.list(undefined, 50) });
  });
  app.post('/queue/:id/replay', async (c) => {
    const services = createServices(c.env);
    const job = await services.queue.replay(c.req.param('id'));
    if (!job) return c.json({ error: 'not_replayable' }, 404);
    c.executionCtx.waitUntil(runJob(c.env, job.id));
    return c.json(job);
  });

  app.get('/stream', async (c) => {
    const leadId = c.req.query('leadId');
    const store = createServices(c.env).store;
    const encoder = new TextEncoder();
    let closed = false;
    const stream = new ReadableStream({
      async start(controller) {
        const seen = new Set<number>();
        const push = async () => {
          const events = await store.eventsFor(leadId);
          for (const event of events) {
            if (seen.has(event.id)) continue;
            seen.add(event.id);
            controller.enqueue(encoder.encode(`event: lead\ndata: ${JSON.stringify(event)}\n\n`));
          }
        };
        try {
          await push();
          for (let i = 0; i < 8 && !closed; i += 1) {
            await scheduler.wait(1000);
            await push();
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
      cancel() {
        closed = true;
      },
    });
    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        'x-accel-buffering': 'no',
      },
    });
  });

  app.onError((error, c) => {
    if (error instanceof ZodError) return c.json({ statusCode: 422, error: 'invalid_payload', issues: issues(error) }, 422);
    if (error instanceof NotInstalledError) return c.json({ error: 'not_installed' }, 409);
    return c.json({ error: 'internal_error' }, 500);
  });

  return app;
}

async function readRaw(c: { req: { text: () => Promise<string>; raw: Request } }): Promise<{ raw: string; headers: Record<string, string> }> {
  const raw = await c.req.text();
  return { raw, headers: flatHeaders(c.req.raw.headers) };
}

async function handleGhl(env: Env, input: { raw: string; headers: Record<string, string> }, ctx: { waitUntil(promise: Promise<unknown>): void }): Promise<Response> {
  const services = createServices(env);
  const verification = verifyWebhookSignature(input.raw, input.headers, webhookKeys(env));
  if (!verification.ok) {
    await services.store.inspect(inspectionForRejection({ source: 'ghl', rawBody: input.raw, headers: input.headers, reason: verification.reason, statusCode: 401 }));
    return Response.json({ statusCode: 401, error: 'invalid_signature', reason: verification.reason }, { status: 401 });
  }
  let json: unknown;
  try {
    json = JSON.parse(input.raw) as unknown;
  } catch {
    await services.store.inspect({ source: 'ghl', eventId: null, signatureValid: true, idempotentHit: false, statusCode: 400, reason: 'invalid_json', rawBody: input.raw, headers: input.headers });
    return Response.json({ statusCode: 400, error: 'invalid_json' }, { status: 400 });
  }
  const parsed = ghlEventSchema.safeParse(json);
  if (!parsed.success) {
    await services.store.inspect({ source: 'ghl', eventId: null, signatureValid: true, idempotentHit: false, statusCode: 422, reason: 'invalid_payload', rawBody: input.raw, headers: input.headers });
    return Response.json({ statusCode: 422, error: 'invalid_payload', issues: issues(parsed.error) }, { status: 422 });
  }
  const stamp = checkTimestamp(parsed.data.timestamp, new Date(), 300_000);
  if (!stamp.ok) {
    await services.store.inspect({
      source: 'ghl',
      eventId: parsed.data.webhookId,
      signatureValid: true,
      idempotentHit: false,
      statusCode: 401,
      reason: stamp.reason,
      rawBody: input.raw,
      headers: input.headers,
    });
    return Response.json({ statusCode: 401, error: 'rejected_timestamp', reason: stamp.reason }, { status: 401 });
  }
  const inserted = await services.store.tryInsertEvent(parsed.data.webhookId, 'ghl');
  if (inserted === 'duplicate') {
    await services.store.inspect({
      source: 'ghl',
      eventId: parsed.data.webhookId,
      signatureValid: true,
      idempotentHit: true,
      statusCode: 200,
      reason: 'duplicate',
      rawBody: input.raw,
      headers: input.headers,
    });
    return Response.json({ success: true, duplicate: true });
  }
  if (isUninstallEvent(parsed.data.type)) {
    await services.tokens.markUninstalled(parsed.data.locationId ?? (await resolveLocationId(env, services.store)));
    resetInstallCache();
    await services.store.inspect({ source: 'ghl', eventId: parsed.data.webhookId, signatureValid: true, idempotentHit: false, statusCode: 200, reason: 'uninstalled', rawBody: input.raw, headers: input.headers });
    return Response.json({ success: true, uninstalled: true });
  }
  if (isMissedCallEvent(parsed.data)) {
    try {
      const lead = parseMissedCall(parsed.data.data ?? {}, new Date(), services.fieldMap);
      const stored = await acceptLead(services, lead, json, 'ghl-webhook');
      const jobId = await services.queue.enqueue('missed-call', { leadId: stored.id }, { correlationId: stored.correlationId });
      ctx.waitUntil(runJob(env, jobId));
      await services.store.inspect({ source: 'ghl', eventId: parsed.data.webhookId, signatureValid: true, idempotentHit: false, statusCode: 200, reason: 'missed_call', rawBody: input.raw, headers: input.headers });
      return Response.json({ success: true, leadId: stored.id });
    } catch (error) {
      if (error instanceof ZodError) {
        await services.store.inspect({ source: 'ghl', eventId: parsed.data.webhookId, signatureValid: true, idempotentHit: false, statusCode: 422, reason: 'invalid_payload', rawBody: input.raw, headers: input.headers });
        return Response.json({ statusCode: 422, error: 'invalid_payload', issues: issues(error) }, { status: 422 });
      }
      throw error;
    }
  }
  await services.store.inspect({
    source: 'ghl',
    eventId: parsed.data.webhookId,
    signatureValid: true,
    idempotentHit: false,
    statusCode: 200,
    reason: 'accepted',
    rawBody: input.raw,
    headers: input.headers,
  });
  return Response.json({ success: true });
}

async function handleMeta(
  env: Env,
  input: { raw: string; headers: Record<string, string> },
  ctx: { waitUntil(promise: Promise<unknown>): void },
): Promise<Response> {
  const services = createServices(env);
  const verification = services.meta.verify({ rawBody: input.raw, headers: headerMap(input.headers) });
  if (!verification.ok) {
    await services.store.inspect(inspectionForRejection({ source: 'meta', rawBody: input.raw, headers: input.headers, reason: verification.reason ?? 'mismatch', statusCode: 401 }));
    return Response.json({ statusCode: 401, error: 'invalid_signature', reason: verification.reason }, { status: 401 });
  }
  let json: unknown;
  try {
    json = JSON.parse(input.raw) as unknown;
  } catch {
    return Response.json({ statusCode: 400, error: 'invalid_json' }, { status: 400 });
  }
  try {
    const leads = services.meta.parse(json, new Date());
    const leadIds: string[] = [];
    let duplicate = false;
    for (const lead of leads) {
      const inserted = await services.store.tryInsertEvent(`meta:${lead.externalId}`, 'meta');
      if (inserted === 'duplicate') {
        duplicate = true;
        continue;
      }
      const stored = await acceptLead(services, lead, json, 'hmac-sha256');
      const jobId = await services.queue.enqueue('speed-to-lead', { leadId: stored.id }, { correlationId: stored.correlationId });
      ctx.waitUntil(runJob(env, jobId));
      leadIds.push(stored.id);
    }
    await services.store.inspect({
      source: 'meta',
      eventId: leads[0]?.externalId ?? null,
      signatureValid: true,
      idempotentHit: duplicate && leadIds.length === 0,
      statusCode: 200,
      reason: duplicate && leadIds.length === 0 ? 'duplicate' : 'accepted',
      rawBody: input.raw,
      headers: input.headers,
    });
    return Response.json({ success: true, leadIds, duplicate: duplicate && leadIds.length === 0 });
  } catch (error) {
    if (error instanceof ZodError) {
      await services.store.inspect({ source: 'meta', eventId: null, signatureValid: true, idempotentHit: false, statusCode: 422, reason: 'invalid_payload', rawBody: input.raw, headers: input.headers });
      return Response.json({ statusCode: 422, error: 'invalid_payload', issues: issues(error) }, { status: 422 });
    }
    throw error;
  }
}

async function handleForm(
  env: Env,
  input: { raw: string; headers: Record<string, string> },
  ctx: { waitUntil(promise: Promise<unknown>): void },
): Promise<Response> {
  const services = createServices(env);
  const verification = services.forms.verify({ rawBody: input.raw, headers: headerMap(input.headers) });
  if (!verification.ok) {
    await services.store.inspect(
      inspectionForRejection({ source: 'website_form', rawBody: input.raw, headers: input.headers, reason: verification.reason ?? 'mismatch', statusCode: 401 }),
    );
    return Response.json({ statusCode: 401, error: 'invalid_signature', reason: verification.reason }, { status: 401 });
  }
  let json: unknown;
  try {
    json = JSON.parse(input.raw) as unknown;
  } catch {
    return Response.json({ statusCode: 400, error: 'invalid_json' }, { status: 400 });
  }
  const submittedAt = typeof json === 'object' && json && 'submittedAt' in json ? (json as { submittedAt?: unknown }).submittedAt : undefined;
  const stamp = checkTimestamp(submittedAt, new Date(), 300_000);
  if (!stamp.ok) {
    await services.store.inspect({ source: 'website_form', eventId: null, signatureValid: true, idempotentHit: false, statusCode: 401, reason: stamp.reason, rawBody: input.raw, headers: input.headers });
    return Response.json({ statusCode: 401, error: 'rejected_timestamp', reason: stamp.reason }, { status: 401 });
  }
  try {
    const [lead] = services.forms.parse(json, new Date());
    if (!lead) return Response.json({ statusCode: 422, error: 'invalid_payload' }, { status: 422 });
    const inserted = await services.store.tryInsertEvent(`form:${lead.externalId}`, 'website_form');
    if (inserted === 'duplicate') {
      await services.store.inspect({ source: 'website_form', eventId: lead.externalId, signatureValid: true, idempotentHit: true, statusCode: 200, reason: 'duplicate', rawBody: input.raw, headers: input.headers });
      return Response.json({ success: true, duplicate: true });
    }
    const stored = await acceptLead(services, lead, json, 'hmac-sha256');
    const jobId = await services.queue.enqueue('speed-to-lead', { leadId: stored.id }, { correlationId: stored.correlationId });
    ctx.waitUntil(runJob(env, jobId));
    await services.store.inspect({ source: 'website_form', eventId: lead.externalId, signatureValid: true, idempotentHit: false, statusCode: 200, reason: 'accepted', rawBody: input.raw, headers: input.headers });
    return Response.json({ success: true, leadId: stored.id });
  } catch (error) {
    if (error instanceof ZodError) {
      await services.store.inspect({ source: 'website_form', eventId: null, signatureValid: true, idempotentHit: false, statusCode: 422, reason: 'invalid_payload', rawBody: input.raw, headers: input.headers });
      return Response.json({ statusCode: 422, error: 'invalid_payload', issues: issues(error) }, { status: 422 });
    }
    throw error;
  }
}

async function proxyCrm(env: Env, pathName: string, query: Record<string, string>, schema: z.ZodType<unknown>): Promise<Response> {
  const services = createServices(env);
  try {
    const locationId = await resolveLocationId(env, services.store);
    const nextQuery = { ...query };
    if ('locationId' in nextQuery) nextQuery.locationId = locationId;
    if ('location_id' in nextQuery) nextQuery.location_id = locationId;
    const token = await services.tokens.getValidAccessToken(locationId);
    const json = await ghlFetch(baseUrl(env), { method: 'GET', path: pathName, token, query: nextQuery }, { fetchImpl: services.fetchImpl });
    return Response.json(schema.parse(json));
  } catch (error) {
    if (error instanceof NotInstalledError) return Response.json({ error: 'not_installed' }, { status: 409 });
    throw error;
  }
}

export async function resetDemo(env: Env): Promise<void> {
  if (!isMock(env)) return;
  await new D1Store(env.DB).clearDemo();
  const stub = env.MOCK.get(env.MOCK.idFromName('northwind'));
  await stub.fetch('https://mock.internal/_debug/reset', { method: 'POST' });
}
