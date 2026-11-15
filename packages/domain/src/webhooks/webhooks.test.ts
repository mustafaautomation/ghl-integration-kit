import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MemoryIdempotencyStore } from './idempotency.js';
import { checkTimestamp } from './replay.js';
import {
  assertPublicKey,
  documentedWebhookKeys,
  signEd25519,
  signRsaSha256,
  verifyWebhookSignature,
} from './verify.js';

function keypair(kind: 'ed25519' | 'rsa') {
  if (kind === 'ed25519') {
    return generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
  }
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

const body = JSON.stringify({
  type: 'ContactCreate',
  webhookId: 'wh_1',
  timestamp: '2026-11-15T12:00:00.000Z',
});

describe('webhook signatures', () => {
  const ed = keypair('ed25519');
  const rsa = keypair('rsa');
  const keys = { ed25519Pem: ed.publicKey, rsaPem: rsa.publicKey };

  it('accepts a valid Ed25519 signature over the raw body', () => {
    const signature = signEd25519(body, ed.privateKey);
    expect(verifyWebhookSignature(body, { 'x-ghl-signature': signature }, keys)).toEqual({
      ok: true,
      algorithm: 'ed25519',
    });
  });

  it('rejects a tampered body', () => {
    const signature = signEd25519(body, ed.privateKey);
    const tampered = body.replace('ContactCreate', 'ContactDelete');
    expect(verifyWebhookSignature(tampered, { 'X-GHL-Signature': signature }, keys)).toEqual({
      ok: false,
      reason: 'mismatch',
    });
  });

  it('rejects a tampered signature', () => {
    const signature = signEd25519(body, ed.privateKey);
    const flipped = Buffer.from(signature, 'base64');
    const first = flipped[0] ?? 0;
    flipped[0] = first ^ 0xff;
    expect(verifyWebhookSignature(body, { 'x-ghl-signature': flipped.toString('base64') }, keys)).toEqual({
      ok: false,
      reason: 'mismatch',
    });
  });

  it('falls back to the legacy RSA header when Ed25519 is absent', () => {
    const signature = signRsaSha256(body, rsa.privateKey);
    expect(verifyWebhookSignature(body, { 'x-wh-signature': signature }, keys)).toEqual({
      ok: true,
      algorithm: 'rsa-sha256',
    });
  });

  it('rejects a tampered legacy signature', () => {
    const signature = signRsaSha256(body, rsa.privateKey);
    expect(verifyWebhookSignature(body.replace('wh_1', 'wh_2'), { 'x-wh-signature': signature }, keys).ok).toBe(false);
  });

  it('prefers Ed25519 when both headers are present', () => {
    const good = signEd25519(body, ed.privateKey);
    expect(
      verifyWebhookSignature(body, { 'x-ghl-signature': good, 'x-wh-signature': 'not-a-signature' }, keys),
    ).toEqual({ ok: true, algorithm: 'ed25519' });
  });

  it('rejects a missing signature', () => {
    expect(verifyWebhookSignature(body, {}, keys)).toEqual({ ok: false, reason: 'missing' });
    expect(verifyWebhookSignature(body, { 'x-ghl-signature': 'N/A', 'x-wh-signature': 'N/A' }, keys)).toEqual({
      ok: false,
      reason: 'missing',
    });
  });

  it('rejects a malformed signature', () => {
    expect(verifyWebhookSignature(body, { 'x-ghl-signature': '%%%' }, keys).ok).toBe(false);
  });

  it('parses the documented public keys', () => {
    const documented = documentedWebhookKeys();
    expect(() => assertPublicKey(documented.ed25519Pem, 'ed25519')).not.toThrow();
    expect(() => assertPublicKey(documented.rsaPem, 'rsa')).not.toThrow();
  });

  it('round-trips the committed test keypair', () => {
    const dir = path.resolve(process.cwd(), 'keys/test');
    const raw = '{"webhookId":"wh_test"}';
    const signature = signEd25519(raw, readFileSync(path.join(dir, 'ed25519-private.pem'), 'utf8'));
    const result = verifyWebhookSignature(raw, { 'x-ghl-signature': signature }, {
      ed25519Pem: readFileSync(path.join(dir, 'ed25519-public.pem'), 'utf8'),
      rsaPem: readFileSync(path.join(dir, 'rsa-public.pem'), 'utf8'),
    });
    expect(result).toEqual({ ok: true, algorithm: 'ed25519' });
  });
});

describe('replay window', () => {
  const now = new Date('2026-11-15T12:00:00.000Z');
  const windowMs = 5 * 60 * 1000;

  it('accepts a fresh timestamp', () => {
    expect(checkTimestamp('2026-11-15T11:58:00.000Z', now, windowMs)).toEqual({ ok: true });
  });

  it('rejects an expired timestamp', () => {
    expect(checkTimestamp('2026-11-15T11:50:00.000Z', now, windowMs)).toEqual({ ok: false, reason: 'stale' });
  });

  it('rejects a timestamp too far in the future', () => {
    expect(checkTimestamp('2026-11-15T12:05:00.000Z', now, windowMs)).toEqual({ ok: false, reason: 'future' });
  });

  it('rejects a missing or invalid timestamp', () => {
    expect(checkTimestamp(undefined, now, windowMs).ok).toBe(false);
    expect(checkTimestamp('yesterday', now, windowMs)).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('idempotency', () => {
  it('inserts once and reports a duplicate the second time', async () => {
    const store = new MemoryIdempotencyStore();
    expect(await store.tryInsert('wh_1', 'ghl')).toBe('inserted');
    expect(await store.tryInsert('wh_1', 'ghl')).toBe('duplicate');
    expect(await store.tryInsert('wh_2', 'ghl')).toBe('inserted');
  });
});
