export type TimestampCheck =
  | { ok: true }
  | { ok: false; reason: 'missing' | 'invalid' | 'stale' | 'future' };

export function checkTimestamp(timestamp: unknown, now: Date, windowMs: number, futureSkewMs = 60_000): TimestampCheck {
  if (typeof timestamp !== 'string' || timestamp.length === 0) {
    return { ok: false, reason: 'missing' };
  }
  const ms = Date.parse(timestamp);
  if (Number.isNaN(ms)) return { ok: false, reason: 'invalid' };
  const delta = now.getTime() - ms;
  if (delta > windowMs) return { ok: false, reason: 'stale' };
  if (delta < -futureSkewMs) return { ok: false, reason: 'future' };
  return { ok: true };
}
