import { applyD1Migrations, createExecutionContext, env, SELF, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/index.js';
import { resetDemo } from '../src/api.js';
import { drain } from '../src/jobs.js';
import { takeRateLimit } from '../src/rate-limit.js';
import { resetInstallCache } from '../src/runtime.js';

interface MigrationBinding {
  DB: D1Database;
  TEST_MIGRATIONS: Array<{ name: string; queries: string[] }>;
}

describe('workers runtime', () => {
  beforeEach(async () => {
    resetInstallCache();
    const bindings = env as unknown as MigrationBinding;
    await applyD1Migrations(bindings.DB, bindings.TEST_MIGRATIONS);
  });
  it('sends the mock install through the internal redirect', async () => {
    const res = await SELF.fetch('https://ghl.test/api/oauth/install', { redirect: 'manual' });
    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    const url = new URL(location);
    expect(url.pathname).toBe('/mock/oauth/chooselocation');
    expect(url.searchParams.get('client_id')).toBe('mock-client-id');
    expect(url.searchParams.get('redirect_uri')).toBe('https://mock.internal/api/oauth/callback');
    expect(url.searchParams.get('scope')).toContain('contacts.write');
    expect(url.searchParams.get('state')).toBeTruthy();
  });

  it('answers health and readiness', async () => {
    expect((await SELF.fetch('https://ghl.test/api/health')).status).toBe(200);
    const ready = await SELF.fetch('https://ghl.test/api/ready');
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({ ok: true, checks: { database: true, queue: true } });
  });

  it('rejects an oversized body', async () => {
    const res = await SELF.fetch('https://ghl.test/api/webhooks/meta', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': '300000' },
      body: '{}',
    });
    expect(res.status).toBe(413);
  });

  it('rejects a bad Meta signature', async () => {
    const res = await SELF.fetch('https://ghl.test/api/webhooks/meta', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=00' },
      body: '{}',
    });
    expect(res.status).toBe(401);
  });

  it('runs a test lead through the mock and the queue', async () => {
    const ctx = createExecutionContext();
    const sent = await worker.fetch(new Request('https://ghl.test/api/demo/test-lead', { method: 'POST' }), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(sent.status).toBe(202);
    const body = (await sent.json()) as { leadId: string };
    expect(body.leadId).toMatch(/^lead_/);
    await drain(env);
    const detail = await SELF.fetch(`https://ghl.test/api/leads/${body.leadId}`);
    const json = (await detail.json()) as { lead: { status: string; firstName: string }; slots: string[]; events: Array<{ type: string; detail: unknown }> };
    const queue = await SELF.fetch('https://ghl.test/api/queue');
    expect(detail.status, JSON.stringify({ lead: json.lead, queue: await queue.json() })).toBe(200);
    expect(json.lead.firstName).toBe('Jordan');
    expect(json.lead.status, JSON.stringify(json.events)).toBe('offered');
    expect(json.slots.length).toBeGreaterThan(0);
    const slot = json.slots[0];
    if (!slot) throw new Error('missing slot');
    const booked = await SELF.fetch(`https://ghl.test/api/leads/${body.leadId}/book`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ startTime: slot }),
    });
    expect(booked.status).toBe(200);
    const after = (await booked.json()) as { lead: { status: string } };
    expect(after.lead.status).toBe('booked');
  });

  it('caps an address inside a window', async () => {
    const ip = '203.0.113.10';
    expect(await takeRateLimit(env.DB, ip, 2, 60_000, 1_700_000_000_000)).toBe(true);
    expect(await takeRateLimit(env.DB, ip, 2, 60_000, 1_700_000_000_000)).toBe(true);
    expect(await takeRateLimit(env.DB, ip, 2, 60_000, 1_700_000_000_000)).toBe(false);
  });

  it('clears demo rows on the cron reset', async () => {
    const ctx = createExecutionContext();
    const sent = await worker.fetch(new Request('https://ghl.test/api/demo/test-lead', { method: 'POST' }), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(sent.status).toBe(202);
    await resetDemo(env);
    const after = await SELF.fetch('https://ghl.test/api/leads');
    expect(await after.json()).toMatchObject({ leads: [] });
  });
});
