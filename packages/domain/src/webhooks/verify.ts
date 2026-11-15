import { createPublicKey, createSign, createVerify, sign as cryptoSign, verify as cryptoVerify } from 'node:crypto';
import { DOCUMENTED_ED25519_PUBLIC_KEY, DOCUMENTED_RSA_PUBLIC_KEY } from './documented-keys.js';

export interface WebhookKeys {
  ed25519Pem: string;
  rsaPem: string;
}

export type SignatureAlgorithm = 'ed25519' | 'rsa-sha256';

export type SignatureVerifyResult =
  | { ok: true; algorithm: SignatureAlgorithm }
  | { ok: false; reason: 'missing' | 'malformed' | 'mismatch' };

export function headerMap(headers: Record<string, string | string[] | undefined>): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key.toLowerCase()] = Array.isArray(value) ? value[0] : value;
  }
  return out;
}

/**
 * Prefer `X-GHL-Signature` (Ed25519 over the raw body). Fall back to the legacy
 * `X-WH-Signature` (RSA-SHA256) only when the Ed25519 header is absent.
 * Verification uses the raw bytes. Re-serializing JSON breaks the signature.
 */
export function verifyWebhookSignature(
  rawBody: string | Buffer,
  headers: Record<string, string | string[] | undefined>,
  keys: WebhookKeys,
): SignatureVerifyResult {
  const normalized = headerMap(headers);
  const ghl = normalized['x-ghl-signature'];
  const legacy = normalized['x-wh-signature'];
  if (ghl && ghl !== 'N/A') {
    return verifyEd25519(rawBody, ghl, keys.ed25519Pem);
  }
  if (legacy && legacy !== 'N/A') {
    return verifyRsaSha256(rawBody, legacy, keys.rsaPem);
  }
  return { ok: false, reason: 'missing' };
}

export function verifyEd25519(rawBody: string | Buffer, signatureB64: string, publicKeyPem: string): SignatureVerifyResult {
  try {
    const signature = Buffer.from(signatureB64, 'base64');
    if (signature.length === 0) return { ok: false, reason: 'malformed' };
    const ok = cryptoVerify(null, Buffer.from(rawBody), publicKeyPem, signature);
    return ok ? { ok: true, algorithm: 'ed25519' } : { ok: false, reason: 'mismatch' };
  } catch {
    return { ok: false, reason: 'malformed' };
  }
}

export function verifyRsaSha256(rawBody: string | Buffer, signatureB64: string, publicKeyPem: string): SignatureVerifyResult {
  try {
    const verifier = createVerify('SHA256');
    verifier.update(rawBody);
    verifier.end();
    const ok = verifier.verify(publicKeyPem, signatureB64, 'base64');
    return ok ? { ok: true, algorithm: 'rsa-sha256' } : { ok: false, reason: 'mismatch' };
  } catch {
    return { ok: false, reason: 'malformed' };
  }
}

export function signEd25519(rawBody: string | Buffer, privateKeyPem: string): string {
  return cryptoSign(null, Buffer.from(rawBody), privateKeyPem).toString('base64');
}

export function signRsaSha256(rawBody: string | Buffer, privateKeyPem: string): string {
  const signer = createSign('SHA256');
  signer.update(rawBody);
  signer.end();
  return signer.sign(privateKeyPem).toString('base64');
}

export function assertPublicKey(pem: string, kind: 'ed25519' | 'rsa'): void {
  const key = createPublicKey(pem);
  if (kind === 'ed25519' && key.asymmetricKeyType !== 'ed25519') {
    throw new Error('expected an Ed25519 public key');
  }
  if (kind === 'rsa' && key.asymmetricKeyType !== 'rsa') {
    throw new Error('expected an RSA public key');
  }
}

export function documentedWebhookKeys(): WebhookKeys {
  return {
    ed25519Pem: DOCUMENTED_ED25519_PUBLIC_KEY,
    rsaPem: DOCUMENTED_RSA_PUBLIC_KEY,
  };
}
