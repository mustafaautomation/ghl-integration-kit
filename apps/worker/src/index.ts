import type { JobMessage } from '@ghl/db/d1';
import { resetDemo, createApp } from './api.js';
import type { Env } from './env.js';
import { runJob } from './jobs.js';
import { MockGhl } from './mock-do.js';
import { takeRateLimit } from './rate-limit.js';
import { createServices } from './runtime.js';

export { MockGhl };

const app = createApp();

function tooLarge(request: Request, env: Env): boolean {
  const limit = Number(env.BODY_LIMIT_BYTES) || 256 * 1024;
  return Number(request.headers.get('content-length') ?? 0) > limit;
}

function clientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

async function limited(request: Request, env: Env): Promise<Response | null> {
  if (tooLarge(request, env)) return Response.json({ error: 'payload_too_large' }, { status: 413 });
  const path = new URL(request.url).pathname;
  if (path === '/api/health' || path === '/api/ready') return null;
  const allowed = await takeRateLimit(
    env.DB,
    clientIp(request),
    Number(env.RATE_LIMIT_MAX) || 120,
    Number(env.RATE_LIMIT_WINDOW_MS) || 60_000,
  );
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': '60' } });
  return null;
}

const handler: ExportedHandler<Env, JobMessage> = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/mock' || url.pathname.startsWith('/mock/')) {
      const blocked = await limited(request, env);
      if (blocked) return blocked;
      const next = new URL(request.url);
      next.hostname = 'mock.internal';
      next.protocol = 'https:';
      next.port = '';
      next.pathname = url.pathname.replace(/^\/mock/, '') || '/';
      const stub = env.MOCK.get(env.MOCK.idFromName('northwind'));
      return stub.fetch(new Request(next, request));
    }
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      const blocked = await limited(request, env);
      if (blocked) return blocked;
      const next = new URL(request.url);
      next.pathname = url.pathname.replace(/^\/api/, '') || '/';
      return app.fetch(new Request(next, request), env, ctx);
    }
    if (/^\/leads\/[^/]+\/?$/.test(url.pathname) && !url.pathname.includes('/_/')) {
      const shell = new URL(request.url);
      shell.pathname = '/leads/_/';
      return env.ASSETS.fetch(new Request(shell, { method: 'GET' }));
    }
    return env.ASSETS.fetch(request);
  },
  async queue(batch, env) {
    for (const message of batch.messages) {
      if (batch.queue === 'ghl-jobs-dlq') {
        await createServices(env).queue.markDead(message.body.jobId, 'dead_letter');
        message.ack();
        continue;
      }
      const result = await runJob(env, message.body.jobId);
      if (result === 'done') message.ack();
      else message.retry(result === 'dead' ? {} : { delaySeconds: result.retrySeconds });
    }
  },
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(resetDemo(env));
  },
};

export default handler;
