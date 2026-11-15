import { describe, expect, it } from 'vitest';
import { computeBackoffMs, parseRetryAfter } from './backoff.js';

describe('rate-limit backoff', () => {
  const now = new Date('2026-11-15T12:00:00.000Z');

  it('parses Retry-After seconds and HTTP dates', () => {
    expect(parseRetryAfter('2', now)).toBe(2000);
    expect(parseRetryAfter('0.5', now)).toBe(500);
    expect(parseRetryAfter('Sun, 15 Nov 2026 12:00:03 GMT', now)).toBe(3000);
    expect(parseRetryAfter(null, now)).toBeNull();
    expect(parseRetryAfter('later', now)).toBeNull();
    expect(parseRetryAfter('Sun, 15 Nov 2026 11:00:00 GMT', now)).toBe(0);
  });

  it('grows exponentially and caps at the max', () => {
    const base = { baseMs: 500, maxMs: 30_000, jitterRatio: 0.2, random: () => 0 };
    expect(computeBackoffMs({ ...base, attempt: 1 })).toBe(500);
    expect(computeBackoffMs({ ...base, attempt: 2 })).toBe(1000);
    expect(computeBackoffMs({ ...base, attempt: 3 })).toBe(2000);
    expect(computeBackoffMs({ ...base, attempt: 20 })).toBe(30_000);
  });

  it('adds jitter inside the ratio', () => {
    const delay = computeBackoffMs({
      attempt: 2,
      baseMs: 500,
      maxMs: 30_000,
      jitterRatio: 0.2,
      random: () => 1,
    });
    expect(delay).toBe(1200);
  });

  it('honours Retry-After even when it is longer than the cap, and adds jitter on top', () => {
    expect(
      computeBackoffMs({
        attempt: 1,
        baseMs: 500,
        maxMs: 30_000,
        jitterRatio: 0.2,
        retryAfterMs: 60_000,
        random: () => 0,
      }),
    ).toBe(60_000);
    expect(
      computeBackoffMs({
        attempt: 4,
        baseMs: 500,
        maxMs: 30_000,
        jitterRatio: 0.25,
        retryAfterMs: 1000,
        random: () => 1,
      }),
    ).toBe(1250);
  });
});
