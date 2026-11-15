import { describe, expect, it } from 'vitest';
import { DEMO_ENCRYPTION_KEY_B64 } from '../ids.js';
import { decryptString, encryptString, parseEncryptionKey } from './aes-gcm.js';

describe('aes-gcm token encryption', () => {
  const key = parseEncryptionKey(DEMO_ENCRYPTION_KEY_B64);

  it('round-trips a token', () => {
    const blob = encryptString('access-token-value', key);
    expect(blob).not.toContain('access-token-value');
    expect(decryptString(blob, key)).toBe('access-token-value');
  });

  it('uses a fresh iv so two encryptions differ', () => {
    const a = encryptString('same', key);
    const b = encryptString('same', key);
    expect(a).not.toBe(b);
  });

  it('rejects a tampered ciphertext', () => {
    const buf = Buffer.from(encryptString('secret-token', key), 'base64');
    const last = buf[buf.length - 1] ?? 0;
    buf[buf.length - 1] = last ^ 0xff;
    expect(() => decryptString(buf.toString('base64'), key)).toThrow();
  });

  it('rejects a short key', () => {
    expect(() => parseEncryptionKey(Buffer.from('short').toString('base64'))).toThrow(/32 bytes/);
  });
});
