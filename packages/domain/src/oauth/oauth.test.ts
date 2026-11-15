import { describe, expect, it, vi } from 'vitest';
import { parseEncryptionKey } from '../crypto/aes-gcm.js';
import { DEMO_ENCRYPTION_KEY_B64 } from '../ids.js';
import {
  authorizationCodeBody,
  buildInstallUrl,
  checkOauthState,
  createOauthState,
  expiryFromExpiresIn,
  needsRefresh,
  OAuthClient,
  refreshTokenBody,
} from './oauth.js';
import { TokenService, type InstallationRecord, type InstallationStore } from './token-service.js';

describe('oauth state', () => {
  it('builds an install url that carries the csrf state', () => {
    const url = new URL(
      buildInstallUrl({
        authorizeUrl: 'https://marketplace.gohighlevel.com/oauth/chooselocation',
        clientId: 'client',
        redirectUri: 'http://localhost:4000/oauth/callback',
        scopes: ['contacts.write', 'conversations/message.write'],
        state: 'state-123',
      }),
    );
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBe('state-123');
    expect(url.searchParams.get('scope')).toContain('contacts.write');
  });

  it('rejects a missing, used, or expired state', () => {
    const now = new Date('2026-11-15T12:00:00.000Z');
    expect(checkOauthState(null, now)).toBe('missing');
    expect(checkOauthState({ expiresAt: new Date('2026-11-15T12:10:00.000Z'), usedAt: now }, now)).toBe('used');
    expect(checkOauthState({ expiresAt: new Date('2026-11-15T11:00:00.000Z'), usedAt: null }, now)).toBe('expired');
    expect(checkOauthState({ expiresAt: new Date('2026-11-15T12:10:00.000Z'), usedAt: null }, now)).toBe('ok');
  });

  it('creates a long random state', () => {
    const created = createOauthState(new Date('2026-11-15T12:00:00.000Z'), 600_000);
    expect(created.state.length).toBeGreaterThan(20);
    expect(created.expiresAt.toISOString()).toBe('2026-11-15T12:10:00.000Z');
  });
});

describe('refresh window', () => {
  const now = new Date('2026-11-15T12:00:00.000Z');

  it('refreshes inside the skew window and not before', () => {
    expect(needsRefresh(new Date('2026-11-15T12:04:00.000Z'), now, 300_000)).toBe(true);
    expect(needsRefresh(new Date('2026-11-15T12:10:00.000Z'), now, 300_000)).toBe(false);
    expect(needsRefresh(new Date('2026-11-15T11:00:00.000Z'), now, 300_000)).toBe(true);
  });

  it('computes expiry from expires_in', () => {
    expect(expiryFromExpiresIn(3600, now).toISOString()).toBe('2026-11-15T13:00:00.000Z');
  });
});

describe('token request bodies', () => {
  it('keeps the code grant and the refresh grant apart', () => {
    const code = authorizationCodeBody({
      clientId: 'id',
      clientSecret: 'secret',
      code: 'abc',
      redirectUri: 'http://localhost/cb',
      userType: 'Location',
    });
    expect(code.get('grant_type')).toBe('authorization_code');
    expect(code.get('refresh_token')).toBeNull();
    const refresh = refreshTokenBody({
      clientId: 'id',
      clientSecret: 'secret',
      refreshToken: 'r1',
      userType: 'Location',
    });
    expect(refresh.get('grant_type')).toBe('refresh_token');
    expect(refresh.get('code')).toBeNull();
  });
});

function memoryStore(initial?: InstallationRecord): InstallationStore & { rows: Map<string, InstallationRecord> } {
  const rows = new Map<string, InstallationRecord>();
  if (initial) rows.set(initial.locationId, initial);
  return {
    rows,
    async get(id) {
      return rows.get(id) ?? null;
    },
    async save(record) {
      rows.set(record.locationId, record);
    },
  };
}

const key = parseEncryptionKey(DEMO_ENCRYPTION_KEY_B64);

describe('TokenService', () => {
  it('returns the stored access token when it is still fresh', async () => {
    const { encryptString } = await import('../crypto/aes-gcm.js');
    const store = memoryStore({
      locationId: 'loc_1',
      userType: 'Location',
      accessTokenEnc: encryptString('access-fresh', key),
      refreshTokenEnc: encryptString('refresh-fresh', key),
      expiresAt: new Date('2026-11-15T18:00:00.000Z'),
      scope: 'contacts.write',
      uninstalledAt: null,
    });
    const refresh = vi.fn();
    const client = { refresh } as unknown as OAuthClient;
    const service = new TokenService(store, client, key, 300_000, () => new Date('2026-11-15T12:00:00.000Z'));
    await expect(service.getValidAccessToken('loc_1')).resolves.toBe('access-fresh');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('rotates the refresh token when the access token is inside the skew window', async () => {
    const { encryptString, decryptString } = await import('../crypto/aes-gcm.js');
    const store = memoryStore({
      locationId: 'loc_1',
      userType: 'Location',
      accessTokenEnc: encryptString('access-old', key),
      refreshTokenEnc: encryptString('refresh-old', key),
      expiresAt: new Date('2026-11-15T12:01:00.000Z'),
      scope: 'contacts.write',
      uninstalledAt: null,
    });
    const refresh = vi.fn().mockResolvedValue({
      access_token: 'access-new',
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: 'refresh-new',
      scope: 'contacts.write',
      userType: 'Location',
      locationId: 'loc_1',
      companyId: 'co_1',
    });
    const client = { refresh } as unknown as OAuthClient;
    const service = new TokenService(store, client, key, 300_000, () => new Date('2026-11-15T12:00:00.000Z'));
    await expect(service.getValidAccessToken('loc_1')).resolves.toBe('access-new');
    expect(refresh).toHaveBeenCalledWith('refresh-old');
    const saved = store.rows.get('loc_1');
    expect(saved).toBeTruthy();
    expect(decryptString(saved!.refreshTokenEnc, key)).toBe('refresh-new');
    expect(decryptString(saved!.accessTokenEnc, key)).toBe('access-new');
  });

  it('shares one refresh across concurrent callers', async () => {
    const { encryptString } = await import('../crypto/aes-gcm.js');
    const store = memoryStore({
      locationId: 'loc_1',
      userType: 'Location',
      accessTokenEnc: encryptString('access-old', key),
      refreshTokenEnc: encryptString('refresh-old', key),
      expiresAt: new Date('2026-11-15T11:00:00.000Z'),
      scope: 'contacts.write',
      uninstalledAt: null,
    });
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const refresh = vi.fn().mockImplementation(async () => {
      await gate;
      return {
        access_token: 'access-new',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'refresh-new',
        scope: 'contacts.write',
        userType: 'Location',
        locationId: 'loc_1',
      };
    });
    const client = { refresh } as unknown as OAuthClient;
    const service = new TokenService(store, client, key, 300_000, () => new Date('2026-11-15T12:00:00.000Z'));
    const first = service.getValidAccessToken('loc_1');
    const second = service.getValidAccessToken('loc_1');
    release!();
    await expect(Promise.all([first, second])).resolves.toEqual(['access-new', 'access-new']);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('refuses a token after uninstall', async () => {
    const { encryptString } = await import('../crypto/aes-gcm.js');
    const store = memoryStore({
      locationId: 'loc_1',
      userType: 'Location',
      accessTokenEnc: encryptString('access-old', key),
      refreshTokenEnc: encryptString('refresh-old', key),
      expiresAt: new Date('2026-11-15T18:00:00.000Z'),
      scope: 'contacts.write',
      uninstalledAt: null,
    });
    const client = { refresh: vi.fn() } as unknown as OAuthClient;
    const service = new TokenService(store, client, key, 300_000, () => new Date('2026-11-15T12:00:00.000Z'));
    await service.markUninstalled('loc_1');
    await expect(service.getValidAccessToken('loc_1')).rejects.toThrow(/not_installed/);
  });
});

describe('OAuthClient', () => {
  it('posts the code exchange and parses the token response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: 'a',
          token_type: 'Bearer',
          expires_in: 86399,
          refresh_token: 'r',
          scope: 'contacts.write',
          userType: 'Location',
          locationId: 'loc_1',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const client = new OAuthClient({
      tokenUrl: 'http://mock/oauth/token',
      clientId: 'id',
      clientSecret: 'secret',
      redirectUri: 'http://localhost/cb',
      userType: 'Location',
      fetchImpl,
    });
    const tokens = await client.exchange('code-1');
    expect(tokens.locationId).toBe('loc_1');
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(String(init.body)).toContain('grant_type=authorization_code');
    expect(String(init.body)).not.toContain('secret-in-logs');
  });

  it('throws a status-only error when the token endpoint fails', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'invalid_grant', client_secret: 'should-not-surface' }), { status: 400 }),
    );
    const client = new OAuthClient({
      tokenUrl: 'http://mock/oauth/token',
      clientId: 'id',
      clientSecret: 'secret',
      redirectUri: 'http://localhost/cb',
      userType: 'Location',
      fetchImpl,
    });
    await expect(client.refresh('r')).rejects.toThrow('oauth_failed_400');
  });
});
