import { describe, expect, it } from 'vitest';
import { DEMO_ENCRYPTION_KEY_B64 } from '@ghl/domain';
import { loadConfig } from './config.js';

const liveEnv = {
  GHL_MODE: 'live',
  DATABASE_URL: 'postgres://ghl:ghl@localhost:5432/ghl',
  GHL_BASE_URL: 'https://services.leadconnectorhq.com',
  GHL_OAUTH_AUTHORIZE_URL: 'https://marketplace.gohighlevel.com/oauth/chooselocation',
  GHL_CLIENT_ID: 'client',
  GHL_CLIENT_SECRET: 'secret',
  GHL_REDIRECT_URI: 'https://example.com/oauth/callback',
  META_VERIFY_TOKEN: 'verify',
  META_APP_SECRET: 'meta',
  FORM_WEBHOOK_SECRET: 'form',
};

describe('config', () => {
  it('refuses the demo encryption key in live mode', () => {
    expect(() => loadConfig({ ...liveEnv, TOKEN_ENCRYPTION_KEY: DEMO_ENCRYPTION_KEY_B64 })).toThrow(/demo encryption key/);
  });
});
