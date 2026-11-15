import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RateLimitError } from './backoff.js';
import { QueueWorker, SqliteJobQueue } from './sqlite-queue.js';

function queue() {
  const dir = mkdtempSync(path.join(tmpdir(), 'ghl-q-'));
  return SqliteJobQueue.open(path.join(dir, 'q.sqlite'), {
    maxAttempts: 3,
    baseMs: 500,
    maxMs: 30_000,
    jitterRatio: 0,
    random: () => 0,
  });
}

describe('sqlite queue', () => {
  it('retries with Retry-After, then completes', () => {
    const q = queue();
    const id = q.enqueue('send', { n: 1 }, { correlationId: 'lead_1', maxAttempts: 3 });
    const first = q.claim(new Date());
    expect(first?.attempts).toBe(1);
    const failed = q.fail(id, new RateLimitError(1500), new Date('2026-11-15T12:00:00.000Z'));
    expect(failed).toEqual({ status: 'pending', delayMs: 1500 });
    expect(q.claim(new Date('2026-11-15T12:00:01.000Z'))).toBeNull();
    const second = q.claim(new Date('2026-11-15T12:00:02.000Z'));
    expect(second?.attempts).toBe(2);
    q.complete(id);
    expect(q.get(id)?.status).toBe('completed');
    q.close();
  });

  it('parks a job on the dead-letter list after the last attempt', () => {
    const q = queue();
    const id = q.enqueue('send', { n: 1 }, { maxAttempts: 2 });
    q.claim(new Date());
    expect(q.fail(id, new Error('nope'), new Date()).status).toBe('pending');
    q.claim(new Date(Date.now() + 60_000));
    expect(q.fail(id, new Error('nope'), new Date()).status).toBe('dead');
    expect(q.list('dead')).toHaveLength(1);
    expect(q.claim(new Date(Date.now() + 120_000))).toBeNull();
    q.close();
  });

  it('returns active jobs to pending on recover', () => {
    const q = queue();
    const id = q.enqueue('send', { n: 1 });
    expect(q.claim(new Date())?.status).toBe('active');
    expect(q.recover()).toBe(1);
    expect(q.get(id)?.status).toBe('pending');
    q.close();
  });

  it('replays a dead job from the start', () => {
    const q = queue();
    const id = q.enqueue('send', { n: 1 }, { maxAttempts: 1 });
    q.claim(new Date());
    expect(q.fail(id, new Error('nope'), new Date()).status).toBe('dead');
    const again = q.replay(id);
    expect(again?.status).toBe('pending');
    expect(again?.attempts).toBe(0);
    expect(q.replay('missing')).toBeNull();
    expect(q.claim(new Date())?.id).toBe(id);
    q.close();
  });

  it('runs a handler from the worker', async () => {
    const q = queue();
    const seen: unknown[] = [];
    const worker = new QueueWorker(
      q,
      {
        send: async (payload) => {
          seen.push(payload);
        },
      },
      10,
    );
    const id = q.enqueue('send', { hello: 'jordan' }, { correlationId: 'lead_9' });
    worker.start();
    const job = await q.wait(id, 2000);
    worker.stop();
    expect(job.status).toBe('completed');
    expect(seen).toEqual([{ hello: 'jordan' }]);
    q.close();
  });
});
