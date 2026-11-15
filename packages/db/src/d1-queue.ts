import { newId, RateLimitError, computeBackoffMs, type Job, type JobStatus } from '@ghl/domain/edge';
import type { SqlDb } from './sql-db.js';

export interface JobMessage {
  jobId: string;
}

export interface JobSender {
  send(body: JobMessage, options?: { delaySeconds?: number }): Promise<unknown>;
}

interface JobRow {
  id: string;
  name: string;
  payload: string;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  run_at: number;
  last_error: string | null;
  correlation_id: string | null;
  created_at: number;
  updated_at: number;
}

function toJob(row: JobRow): Job {
  return {
    id: row.id,
    name: row.name,
    payload: JSON.parse(row.payload) as unknown,
    status: row.status,
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    runAt: Number(row.run_at),
    lastError: row.last_error,
    correlationId: row.correlation_id,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

/**
 * Job rows live in D1 so the console can list them. Cloudflare Queues delivers the id.
 * Claim is a conditional update, so a queue retry and a waitUntil run cannot both take the same job.
 */
export class D1Queue {
  constructor(
    private readonly db: SqlDb,
    private readonly sender: JobSender,
    private readonly opts: { maxAttempts: number; baseMs: number; maxMs: number; jitterRatio: number } = {
      maxAttempts: 5,
      baseMs: 500,
      maxMs: 30_000,
      jitterRatio: 0,
    },
  ) {}

  async enqueue(
    name: string,
    payload: unknown,
    extra?: { correlationId?: string; runAt?: Date; maxAttempts?: number },
  ): Promise<string> {
    const now = Date.now();
    const id = newId('job');
    await this.db
      .prepare(
        `INSERT INTO jobs (
          id, name, payload, status, attempts, max_attempts, run_at, last_error, correlation_id, created_at, updated_at
        ) VALUES (?, ?, ?, 'pending', 0, ?, ?, NULL, ?, ?, ?)`,
      )
      .bind(
        id,
        name,
        JSON.stringify(payload),
        extra?.maxAttempts ?? this.opts.maxAttempts,
        extra?.runAt?.getTime() ?? now,
        extra?.correlationId ?? null,
        now,
        now,
      )
      .run();
    await this.sender.send({ jobId: id });
    return id;
  }

  async get(id: string): Promise<Job | null> {
    const row = await this.db.prepare('SELECT * FROM jobs WHERE id = ?').bind(id).first<JobRow>();
    return row ? toJob(row) : null;
  }

  async claim(id: string, now = Date.now()): Promise<Job | null> {
    const staleBefore = now - 30_000;
    await this.db
      .prepare(`UPDATE jobs SET status = 'pending', updated_at = ? WHERE id = ? AND status = 'active' AND updated_at < ?`)
      .bind(now, id, staleBefore)
      .run();
    const row = await this.db
      .prepare(
        `UPDATE jobs SET status = 'active', attempts = attempts + 1, updated_at = ?
         WHERE id = ? AND status = 'pending' AND run_at <= ?
         RETURNING *`,
      )
      .bind(now, id, now)
      .first<JobRow>();
    return row ? toJob(row) : null;
  }

  async complete(id: string): Promise<void> {
    await this.db.prepare(`UPDATE jobs SET status = 'completed', updated_at = ? WHERE id = ?`).bind(Date.now(), id).run();
  }

  async fail(id: string, error: unknown, now = new Date()): Promise<{ status: 'pending' | 'dead'; delayMs: number }> {
    const row = await this.db.prepare('SELECT * FROM jobs WHERE id = ?').bind(id).first<JobRow>();
    if (!row) throw new Error(`missing job ${id}`);
    const message = error instanceof Error ? `${error.name}: ${error.message}` : 'unknown_error';
    const retryAfterMs = error instanceof RateLimitError ? error.retryAfterMs : null;
    if (Number(row.attempts) >= Number(row.max_attempts)) {
      await this.db
        .prepare(`UPDATE jobs SET status = 'dead', last_error = ?, updated_at = ? WHERE id = ?`)
        .bind(message, now.getTime(), id)
        .run();
      return { status: 'dead', delayMs: 0 };
    }
    const delayMs = computeBackoffMs({
      attempt: Number(row.attempts),
      baseMs: this.opts.baseMs,
      maxMs: this.opts.maxMs,
      jitterRatio: this.opts.jitterRatio,
      retryAfterMs,
      random: () => 0,
    });
    await this.db
      .prepare(`UPDATE jobs SET status = 'pending', last_error = ?, run_at = ?, updated_at = ? WHERE id = ?`)
      .bind(message, now.getTime() + delayMs, now.getTime(), id)
      .run();
    return { status: 'pending', delayMs };
  }

  async replay(id: string): Promise<Job | null> {
    const current = await this.get(id);
    if (!current || current.status !== 'dead') return null;
    const now = Date.now();
    await this.db
      .prepare(`UPDATE jobs SET status = 'pending', attempts = 0, last_error = NULL, run_at = ?, updated_at = ? WHERE id = ?`)
      .bind(now, now, id)
      .run();
    await this.sender.send({ jobId: id });
    return this.get(id);
  }

  async list(status?: JobStatus, limit = 50): Promise<Job[]> {
    const rows = status
      ? await this.db.prepare('SELECT * FROM jobs WHERE status = ? ORDER BY updated_at DESC LIMIT ?').bind(status, limit).all<JobRow>()
      : await this.db.prepare('SELECT * FROM jobs ORDER BY updated_at DESC LIMIT ?').bind(limit).all<JobRow>();
    return rows.results.map(toJob);
  }

  async markDead(id: string, reason: string): Promise<void> {
    await this.db
      .prepare(`UPDATE jobs SET status = 'dead', last_error = ?, updated_at = ? WHERE id = ? AND status != 'completed'`)
      .bind(reason, Date.now(), id)
      .run();
  }

  async due(now = Date.now(), limit = 20): Promise<Job[]> {
    const rows = await this.db
      .prepare(`SELECT * FROM jobs WHERE status = 'pending' AND run_at <= ? ORDER BY run_at ASC LIMIT ?`)
      .bind(now, limit)
      .all<JobRow>();
    return rows.results.map(toJob);
  }
}
