import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger } from './logger.js';

describe('log redaction', () => {
  it('drops tokens and secrets from the JSON line', () => {
    const lines: string[] = [];
    const dest = new Writable({
      write(chunk, _enc, cb) {
        lines.push(String(chunk));
        cb();
      },
    });
    const log = createLogger('info', dest);
    log.info(
      {
        access_token: 'secret-token-value',
        refresh_token: 'refresh-secret-value',
        nested: { client_secret: 'client-secret-value' },
        correlationId: 'lead_abc',
      },
      'token response',
    );
    const out = lines.join('');
    expect(out).not.toContain('secret-token-value');
    expect(out).not.toContain('refresh-secret-value');
    expect(out).not.toContain('client-secret-value');
    expect(out).toContain('[Redacted]');
    expect(out).toContain('lead_abc');
    expect(out).toContain('"correlationId"');
  });
});
