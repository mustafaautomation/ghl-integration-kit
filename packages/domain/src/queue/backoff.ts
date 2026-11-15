export class RateLimitError extends Error {
  readonly retryAfterMs: number | null;
  readonly status = 429 as const;

  constructor(retryAfterMs: number | null) {
    super('rate_limited');
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

export class GhlApiError extends Error {
  readonly status: number;
  constructor(status: number, message = 'ghl_request_failed') {
    super(message);
    this.name = 'GhlApiError';
    this.status = status;
  }
}

/** Seconds or an HTTP date. Returns milliseconds from `now`, or null when the header is absent or junk. */
export function parseRetryAfter(header: string | null | undefined, now: Date): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (!trimmed) return null;
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return Math.max(0, Math.round(Number(trimmed) * 1000));
  }
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - now.getTime());
}

export function computeBackoffMs(input: {
  attempt: number;
  baseMs: number;
  maxMs: number;
  jitterRatio: number;
  retryAfterMs?: number | null;
  random?: () => number;
}): number {
  const random = input.random ?? Math.random;
  const ratio = Math.max(0, input.jitterRatio);
  if (input.retryAfterMs != null && input.retryAfterMs >= 0) {
    return Math.round(input.retryAfterMs + input.retryAfterMs * ratio * random());
  }
  const exponent = Math.max(0, input.attempt - 1);
  const exp = Math.min(input.maxMs, input.baseMs * 2 ** exponent);
  const jitter = exp * ratio * random();
  return Math.round(Math.min(input.maxMs, exp + jitter));
}
