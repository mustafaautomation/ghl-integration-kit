import { describe, expect, it } from 'vitest';
import { bucketHours } from './stats.js';

describe('bucketHours', () => {
  const now = new Date('2026-11-15T12:00:00.000Z');

  it('puts events in the hour they happened and leaves the rest empty', () => {
    const series = bucketHours(
      [new Date('2026-11-15T11:10:00.000Z'), new Date('2026-11-15T11:40:00.000Z'), new Date('2026-11-15T04:00:00.000Z')],
      now,
      8,
    );
    expect(series).toEqual([1, 0, 0, 0, 0, 0, 0, 2]);
  });

  it('drops events outside the window', () => {
    expect(bucketHours([new Date('2026-11-14T12:00:00.000Z')], now, 8)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });
});