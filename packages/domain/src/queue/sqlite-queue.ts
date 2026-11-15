import Database from 'better-sqlite3';
import { newId } from '../ids.js';
import { computeBackoffMs, RateLimitError } from './backoff.js';

export type JobStatus = 'pending' | 'active' | 'completed' | 'dead';

export interface Job {
  id: string;
  name: string;
  payload: unknown;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  runAt: number;
  lastError: string | null;
  correlationId: string | null;
  createdAt: number;
  updatedAt: number;
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

export interface QueueOptions {
  maxAttempts: number;
  baseMs: number;
  maxMs: number;
  jitterRatio: number;
  random?: () => number;
}

function toJob(row: JobRow): Job {
  return {
    id: row.id,
    name: row.name,
    payload: JSON.parse(row.payload) as unknown,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    runAt: row.run_at,
    lastError: row.last_error,
    correlationId: row.correlation_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * A single-process durable queue. Jobs live in SQLite so a restart does not drop them.
 * `claim` is a write transaction, so two workers in one process cannot take the same row.
 */
export class SqliteJobQueue {
  private readonly claimTx: (nowMs: number) => Job | null;

  constructor(
    readonly db: Database.Database,
    private readonly opts: QueueOptions,
  ) {
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        payload TEXT NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL,
        run_at INTEGER NOT NULL,
        last_error TEXT,
        correlation_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS jobs_pending_idx ON jobs (status, run_at, created_at);
    `);
    this.claimTx = this.db.transaction((nowMs: number) => {
      const row = this.db
        .prepare(
          `SELECT * FROM jobs WHERE status = 'pending' AND run_at <= ? ORDER BY run_at ASC, created_at ASC LIMIT 1`,
        )
        .get(nowMs) as JobRow | undefined;
      if (!row) return null;
      this.db.prepare(`UPDATE jobs SET status = 'active', attempts = attempts + 1, updated_at = ? WHERE id = ?`).run(nowMs, row.id);
      return toJob({ ...row, status: 'active', attempts: row.attempts + 1, updated_at: nowMs });
    });
  }

  static open(path: string, opts: QueueOptions): SqliteJobQueue {
    const db = new Database(path);
    const queue = new SqliteJobQueue(db, opts);
    queue.recover();
    return queue;
  }

  recover(): number {
    const now = Date.now();
    const result = this.db.prepare(`UPDATE jobs SET status = 'pending', updated_at = ? WHERE status = 'active'`).run(now);
    return Number(result.changes);
  }

  enqueue(
    name: string,
    payload: unknown,
    extra?: { correlationId?: string; runAt?: Date; maxAttempts?: number },
  ): string {
    const now = Date.now();
    const id = newId('job');
    this.db
      .prepare(
        `INSERT INTO jobs (id, name, payload, status, attempts, max_attempts, run_at, last_error, correlation_id, created_at, updated_at)
         VALUES (?, ?, ?, 'pending', 0, ?, ?, NULL, ?, ?, ?)`,
      )
      .run(
        id,
        name,
        JSON.stringify(payload),
        extra?.maxAttempts ?? this.opts.maxAttempts,
        extra?.runAt?.getTime() ?? now,
        extra?.correlationId ?? null,
        now,
        now,
      );
    return id;
  }

  claim(now: Date): Job | null {
    return this.claimTx(now.getTime());
  }

  complete(id: string): void {
    this.db.prepare(`UPDATE jobs SET status = 'completed', updated_at = ? WHERE id = ?`).run(Date.now(), id);
  }

  fail(id: string, error: unknown, now: Date): { status: 'pending' | 'dead'; delayMs: number } {
    const row = this.db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(id) as JobRow | undefined;
    if (!row) throw new Error(`missing job ${id}`);
    const message = error instanceof Error ? error.name + ': ' + error.message : 'unknown_error';
    const retryAfterMs = error instanceof RateLimitError ? error.retryAfterMs : null;
    if (row.attempts >= row.max_attempts) {
      this.db
        .prepare(`UPDATE jobs SET status = 'dead', last_error = ?, updated_at = ? WHERE id = ?`)
        .run(message, now.getTime(), id);
      return { status: 'dead', delayMs: 0 };
    }
    const delayMs = computeBackoffMs({
      attempt: row.attempts,
      baseMs: this.opts.baseMs,
      maxMs: this.opts.maxMs,
      jitterRatio: this.opts.jitterRatio,
      retryAfterMs,
      random: this.opts.random,
    });
    this.db
      .prepare(`UPDATE jobs SET status = 'pending', last_error = ?, run_at = ?, updated_at = ? WHERE id = ?`)
      .run(message, now.getTime() + delayMs, now.getTime(), id);
    return { status: 'pending', delayMs };
  }

  get(id: string): Job | null {
    const row = this.db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(id) as JobRow | undefined;
    return row ? toJob(row) : null;
  }

  list(status?: JobStatus, limit = 50): Job[] {
    const rows = (
      status
        ? this.db.prepare(`SELECT * FROM jobs WHERE status = ? ORDER BY updated_at DESC LIMIT ?`).all(status, limit)
        : this.db.prepare(`SELECT * FROM jobs ORDER BY updated_at DESC LIMIT ?`).all(limit)
    ) as JobRow[];
    return rows.map(toJob);
  }

  async wait(id: string, timeoutMs: number, pollMs = 25): Promise<Job> {
    const start = Date.now();
    for (;;) {
      const job = this.get(id);
      if (!job) throw new Error(`missing job ${id}`);
      if (job.status === 'completed' || job.status === 'dead') return job;
      if (Date.now() - start > timeoutMs) return job;
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }

  close(): void {
    this.db.close();
  }
}

export type JobHandler = (payload: unknown, job: Job) => Promise<void>;

export class QueueWorker {
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private pumping = false;

  constructor(
    private readonly queue: SqliteJobQueue,
    private readonly handlers: Record<string, JobHandler>,
    private readonly pollMs: number,
  ) {}

  start(): void {
    this.stopped = false;
    void this.loop();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private async loop(): Promise<void> {
    if (this.stopped || this.pumping) return;
    this.pumping = true;
    try {
      const job = this.queue.claim(new Date());
      if (job) {
        const handler = this.handlers[job.name];
        try {
          if (!handler) throw new Error(`no_handler:${job.name}`);
          await handler(job.payload, job);
          this.queue.complete(job.id);
        } catch (error) {
          this.queue.fail(job.id, error, new Date());
        }
      }
    } finally {
      this.pumping = false;
      if (!this.stopped) {
        this.timer = setTimeout(() => void this.loop(), this.pollMs);
      }
    }
  }
}
