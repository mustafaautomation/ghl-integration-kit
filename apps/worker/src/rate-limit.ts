import type { SqlDb } from '@ghl/db/d1';

export function rateWindow(now: number, windowMs: number): number {
  const size = windowMs > 0 ? windowMs : 60_000;
  return now - (now % size);
}

/** One row per IP per window. Returns false when this request is over the cap. */
export async function takeRateLimit(db: SqlDb, ip: string, max: number, windowMs: number, now = Date.now()): Promise<boolean> {
  if (max <= 0) return true;
  const windowStart = rateWindow(now, windowMs);
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (ip, window_start, count) VALUES (?, ?, 1)
       ON CONFLICT(ip, window_start) DO UPDATE SET count = count + 1
       RETURNING count`,
    )
    .bind(ip, windowStart)
    .first<{ count: number }>();
  return Number(row?.count ?? 1) <= max;
}
