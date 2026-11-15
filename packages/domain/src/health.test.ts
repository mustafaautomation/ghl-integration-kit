import { describe, expect, it } from 'vitest';
import { readiness } from './health.js';

describe('readiness', () => {
  it('is ready only when the database and the queue are both up', () => {
    expect(readiness({ database: true, queue: true }).ok).toBe(true);
    expect(readiness({ database: false, queue: true }).ok).toBe(false);
    expect(readiness({ database: true, queue: false }).ok).toBe(false);
  });
});
