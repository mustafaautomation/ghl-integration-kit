import { describe, expect, it } from 'vitest';
import { toE164 } from './phone.js';

describe('phone normalisation', () => {
  it('normalises US display numbers to E.164', () => {
    expect(toE164('+1 202-555-0148')).toBe('+12025550148');
    expect(toE164('(202) 555-0148')).toBe('+12025550148');
    expect(toE164('415.555.0134')).toBe('+14155550134');
    expect(toE164('1-312-555-0176')).toBe('+13125550176');
  });

  it('keeps an existing E.164 number', () => {
    expect(toE164('+447911123456', 'US')).toBe('+447911123456');
  });

  it('returns null for junk', () => {
    expect(toE164('')).toBeNull();
    expect(toE164('   ')).toBeNull();
    expect(toE164('call me')).toBeNull();
    expect(toE164('123')).toBeNull();
    expect(toE164(undefined)).toBeNull();
  });
});
