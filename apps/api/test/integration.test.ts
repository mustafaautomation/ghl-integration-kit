import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createDb, migrate } from '@ghl/db';
import { signEd25519, signFormBody, signRsaSha256 } from '@ghl/domain';
import { startMock } from '@ghl/mock';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer, ensureInstallation, type AppContext } from '../src/app.js';
import { loadConfig } from '../src/config.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for integration tests');
}

const edPrivate = readFileSync(path.resolve('keys/test/ed25519-private.pem'), 'utf8');
const rsaPrivate = readFileSync(path.resolve('keys/test/rsa-private.pem'), 'utf8');

async function waitFor<T>(fn: () => Promise<T | undefined | null | false>, timeoutMs = 10_000): Promise<T> {
  const start = Date.now();
  let last: unknown;
  while (Date.now() - start < timeoutMs) {
    last = await fn();
    if (last) return last as T;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`timed out: ${JSON.stringify(last)}`);
}

describe('speed-to-lead over HTTP', () => {
  let base = '';
  let mockUrl = '';
  let closeAll: (() => Promise<void>) | undefined;
  let ctx: AppContext;

  beforeAll(async () => {
    const mock = await startMock({ port: 0, host: '127.0.0.1' });
    mockUrl = mock.url;
    const { sql, db } = createDb(databaseUrl!);
    await migrate(sql);
    await sql`TRUNCATE TABLE lead_events, offered_slots, leads, identities, webhook_inspections, webhook_events, oauth_states, installations RESTART IDENTITY CASCADE`;
    const queuePath = path.join(mkdtempSync(path.join(tmpdir(), 'ghl-api-')), 'queue.sqlite');
    const config = loadConfig({
      ...process.env,
      GHL_MODE: 'mock',
      DATABASE_URL: databaseUrl,
      QUEUE_DB_PATH: queuePath,
      LOG_LEVEL: 'silent',
      GHL_BASE_URL: mock.url,
      GHL_OAUTH_AUTHORIZE_URL: `${mock.url}/oauth/chooselocation`,
      GHL_CLIENT_ID: 'mock-client-id',
      GHL_CLIENT_SECRET: 'mock-client-secret',
      GHL_REDIRECT_URI: 'http://127.0.0.1:4000/oauth/callback',
      TOKEN_ENCRYPTION_KEY: 'ZGVtby1vbmx5LWtleS1ub3QtZm9yLWxpdmUtdXNlISE=',
      META_VERIFY_TOKEN: 'mock-meta-verify',
      META_APP_SECRET: 'mock-meta-secret',
      FORM_WEBHOOK_SECRET: 'mock-form-secret',
      CONSOLE_ORIGIN: 'http://127.0.0.1:3000',
      QUEUE_POLL_MS: '30',
      QUEUE_BASE_BACKOFF_MS: '20',
      QUEUE_JITTER_RATIO: '0',
    });
    const built = await buildServer({ config, db, sql });
    ctx = built.ctx;
    await built.app.listen({ port: 0, host: '127.0.0.1' });
    const address = built.app.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    base = `http://127.0.0.1:${port}`;
    await ensureInstallation(ctx);
    built.worker.start();
    closeAll = async () => {
      built.worker.stop();
      await built.app.close();
      ctx.queue.close();
      await sql.end();
      await mock.app.close();
    };
  }, 30_000);

  afterAll(async () => {
    await closeAll?.();
  });

  it('answers health and readiness', async () => {
    expect((await fetch(`${base}/health`)).status).toBe(200);
    const ready = await fetch(`${base}/ready`);
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({ ok: true });
  });

  it('runs a fake Meta lead through contact, text, opportunity, slots, and booking', async () => {
    const created = await fetch(`${base}/demo/test-lead`, { method: 'POST' });
    expect(created.status).toBe(202);
    const { leadId } = (await created.json()) as { leadId: string };
    const detail = await waitFor(async () => {
      const body = (await (await fetch(`${base}/leads/${leadId}`)).json()) as {
        events: Array<{ type: string }>;
        slots: string[];
        lead: { status: string; firstName: string; phoneE164: string };
      };
      return body.events.some((event) => event.type === 'slots_offered') ? body : null;
    });
    expect(detail.lead.firstName).toBe('Jordan');
    expect(detail.lead.phoneE164).toBe('+12025550148');
    expect(detail.events.map((event) => event.type)).toEqual([
      'received',
      'verified',
      'upserted',
      'sms_sent',
      'email_sent',
      'opportunity_created',
      'slots_offered',
    ]);
    const slot = detail.slots[0];
    expect(slot).toBeTruthy();
    const booked = await fetch(`${base}/leads/${leadId}/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startTime: slot }),
    });
    expect(booked.status).toBe(200);
    const after = (await booked.json()) as { lead: { status: string }; events: Array<{ type: string }> };
    expect(after.lead.status).toBe('booked');
    expect(after.events.map((event) => event.type)).toContain('stage_moved');

    const contacts = (await (await fetch(`${base}/crm/contacts`)).json()) as { contacts: Array<{ email?: string }> };
    expect(contacts.contacts.some((contact) => contact.email === 'jordan.hale@example.com')).toBe(true);
    const opportunities = (await (await fetch(`${base}/crm/opportunities`)).json()) as {
      opportunities: Array<{ pipelineStageId: string }>;
    };
    expect(opportunities.opportunities.some((row) => row.pipelineStageId === 'stage_booked')).toBe(true);
    const appointments = (await (await fetch(`${base}/crm/appointments`)).json()) as { events: unknown[] };
    expect(appointments.events.length).toBeGreaterThan(0);

    const inspections = (await (await fetch(`${base}/inspections`)).json()) as {
      inspections: Array<{ source: string; signatureValid: boolean }>;
    };
    expect(inspections.inspections.some((row) => row.source === 'meta' && row.signatureValid)).toBe(true);
  });

  it('rejects a bad signature, a stale timestamp, and a replayed event id', async () => {
    const fresh = {
      type: 'ContactCreate',
      webhookId: 'wh_fresh_1',
      timestamp: new Date().toISOString(),
      locationId: 'loc_northwind_555',
      data: { firstName: 'Casey' },
    };
    const raw = JSON.stringify(fresh);
    const bad = await fetch(`${base}/webhooks/ghl`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ghl-signature': 'aaaa' },
      body: raw,
    });
    expect(bad.status).toBe(401);

    const staleBody = { ...fresh, webhookId: 'wh_stale_1', timestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString() };
    const staleRaw = JSON.stringify(staleBody);
    const stale = await fetch(`${base}/webhooks/ghl`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ghl-signature': signEd25519(staleRaw, edPrivate) },
      body: staleRaw,
    });
    expect(stale.status).toBe(401);
    expect(await stale.json()).toMatchObject({ reason: 'stale' });

    const ok = await fetch(`${base}/webhooks/ghl`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ghl-signature': signEd25519(raw, edPrivate) },
      body: raw,
    });
    expect(ok.status).toBe(200);
    const again = await fetch(`${base}/webhooks/ghl`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ghl-signature': signEd25519(raw, edPrivate) },
      body: raw,
    });
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ duplicate: true });

    const legacyRaw = JSON.stringify({ ...fresh, webhookId: 'wh_legacy_1', timestamp: new Date().toISOString() });
    const legacy = await fetch(`${base}/webhooks/ghl`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-wh-signature': signRsaSha256(legacyRaw, rsaPrivate) },
      body: legacyRaw,
    });
    expect(legacy.status).toBe(200);

    const inspections = (await (await fetch(`${base}/inspections`)).json()) as {
      inspections: Array<{ signatureValid: boolean; reason: string | null; idempotentHit: boolean }>;
    };
    expect(inspections.inspections.some((row) => row.signatureValid === false)).toBe(true);
    expect(inspections.inspections.some((row) => row.idempotentHit)).toBe(true);
  });

  it('accepts a website form and a missed call', async () => {
    const form = {
      id: 'form_evt_integration',
      submittedAt: new Date().toISOString(),
      first_name: 'Priya',
      last_name: 'Shah',
      email: 'priya.shah@example.com',
      phone: '415-555-0134',
      service: 'Brand workshop',
      page: 'https://example.com/start',
    };
    const raw = JSON.stringify(form);
    const res = await fetch(`${base}/webhooks/forms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-form-signature': signFormBody(raw, 'mock-form-secret') },
      body: raw,
    });
    expect(res.status).toBe(200);
    const { leadId } = (await res.json()) as { leadId: string };
    const detail = await waitFor(async () => {
      const body = (await (await fetch(`${base}/leads/${leadId}`)).json()) as { events: Array<{ type: string }> };
      return body.events.some((event) => event.type === 'slots_offered') ? body : null;
    });
    expect(detail.events.some((event) => event.type === 'sms_sent')).toBe(true);

    const call = {
      type: 'InboundCall',
      webhookId: 'wh_call_integration',
      timestamp: new Date().toISOString(),
      locationId: 'loc_northwind_555',
      data: {
        callStatus: 'missed',
        from: '+1 312-555-0176',
        contactName: 'Sam Okonkwo',
        email: 'sam.okonkwo@example.com',
        callId: 'call_integration',
      },
    };
    const callRaw = JSON.stringify(call);
    const callRes = await fetch(`${base}/webhooks/ghl`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ghl-signature': signEd25519(callRaw, edPrivate) },
      body: callRaw,
    });
    expect(callRes.status).toBe(200);
    const { leadId: callLead } = (await callRes.json()) as { leadId: string };
    const callDetail = await waitFor(async () => {
      const body = (await (await fetch(`${base}/leads/${callLead}`)).json()) as { events: Array<{ type: string }>; lead: { status: string } };
      return body.events.some((event) => event.type === 'text_back') ? body : null;
    });
    expect(callDetail.lead.status).toBe('text_back');
  });

  it('completes the oauth callback and refreshes an expired token', async () => {
    const install = await fetch(`${base}/oauth/install`, { redirect: 'manual' });
    expect(install.status).toBe(302);
    const location = new URL(install.headers.get('location') ?? '');
    location.searchParams.set('format', 'json');
    const issued = (await (await fetch(location)).json()) as { code: string; state: string };
    const callback = await fetch(`${base}/oauth/callback?code=${issued.code}&state=${issued.state}`, { redirect: 'manual' });
    expect(callback.status).toBe(302);
    const reused = await fetch(`${base}/oauth/callback?code=${issued.code}&state=${issued.state}`, { redirect: 'manual' });
    expect(reused.status).toBe(400);

    const handshake = await fetch(`${base}/webhooks/meta?hub.mode=subscribe&hub.verify_token=mock-meta-verify&hub.challenge=555`);
    expect(await handshake.text()).toBe('555');

    await ctx.sql`update installations set expires_at = now() - interval '1 hour'`;
    const before = (await (await fetch(`${mockUrl}/_debug/counters`)).json()) as { refreshes: number };
    const contacts = await fetch(`${base}/crm/contacts`);
    expect(contacts.status).toBe(200);
    const after = (await (await fetch(`${mockUrl}/_debug/counters`)).json()) as { refreshes: number };
    expect(after.refreshes).toBe(before.refreshes + 1);
  });

  it('rejects an invalid Meta verify token', async () => {
    const res = await fetch(`${base}/webhooks/meta?hub.mode=subscribe&hub.verify_token=wrong-token&hub.challenge=9`);
    expect(res.status).toBe(403);
    expect(await res.text()).not.toBe('9');
  });

  it('honours Retry-After when GHL returns 429, then completes', async () => {
    const started = Date.now();
    const res = await fetch(`${base}/demo/fail-outbound`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ failures: 1, retryAfterSeconds: 2, maxAttempts: 3 }),
    });
    expect(res.status).toBe(202);
    const { jobId } = (await res.json()) as { jobId: string };
    const job = await waitFor(async () => {
      const body = (await (await fetch(`${base}/queue`)).json()) as {
        recent: Array<{ id: string; status: string; attempts: number; lastError: string | null; updatedAt: number }>;
      };
      const found = body.recent.find((row) => row.id === jobId);
      return found && (found.status === 'completed' || found.status === 'dead') ? found : null;
    }, 15_000);
    expect(job.status).toBe('completed');
    expect(job.attempts).toBe(2);
    expect(job.lastError).toMatch(/rate_limited/);
    expect(job.updatedAt - started).toBeGreaterThanOrEqual(1_500);
  });

  it('marks the location uninstalled', async () => {
    const body = {
      type: 'UNINSTALL',
      webhookId: 'wh_uninstall_integration',
      timestamp: new Date().toISOString(),
      locationId: 'loc_northwind_555',
    };
    const raw = JSON.stringify(body);
    const res = await fetch(`${base}/webhooks/ghl`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ghl-signature': signEd25519(raw, edPrivate) },
      body: raw,
    });
    expect(res.status).toBe(200);
    expect((await fetch(`${base}/crm/contacts`)).status).toBe(409);
    await ensureInstallation(ctx);
    expect((await fetch(`${base}/crm/contacts`)).status).toBe(200);
  });
});
