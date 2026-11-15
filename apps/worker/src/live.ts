import { DEMO_ENCRYPTION_KEY_B64 } from '@ghl/domain/edge';

export const MOCK_REDIRECT_URI = 'https://mock.internal/api/oauth/callback';
export const MOCK_CLIENT_ID = 'mock-client-id';
export const MOCK_CLIENT_SECRET = 'mock-client-secret';
export const MOCK_META_VERIFY_TOKEN = 'mock-meta-verify';
export const MOCK_META_APP_SECRET = 'mock-meta-secret';
export const MOCK_FORM_SECRET = 'mock-form-secret';
export const MOCK_LOCATION_ID = 'loc_northwind_555';

export interface LiveEnv {
  GHL_MODE?: string;
  GHL_REDIRECT_URI?: string;
  GHL_CLIENT_ID?: string;
  GHL_CLIENT_SECRET?: string;
  GHL_USER_TYPE?: string;
  GHL_BASE_URL?: string;
  TOKEN_ENCRYPTION_KEY?: string;
  META_VERIFY_TOKEN?: string;
  META_APP_SECRET?: string;
  FORM_WEBHOOK_SECRET?: string;
  LOCATION_ID?: string;
}

export function isLive(env: { GHL_MODE?: string }): boolean {
  return env.GHL_MODE === 'live';
}

function required(env: { GHL_MODE?: string }, name: string, value: string | undefined, mockDefault: string): string {
  const trimmed = value?.trim() ?? '';
  if (!isLive(env)) return trimmed || mockDefault;
  if (!trimmed) throw new Error(`${name} is required in live mode.`);
  return trimmed;
}

/** Mock installs use the internal callback. Live mode must use the URI registered on the HighLevel app. */
export function oauthRedirectUri(env: LiveEnv): string {
  if (!isLive(env)) return MOCK_REDIRECT_URI;
  const value = env.GHL_REDIRECT_URI?.trim() ?? '';
  if (!value) {
    throw new Error(
      'GHL_REDIRECT_URI is required in live mode. Register https://leadrouter.squishwala.workers.dev/api/oauth/callback or https://leads.quvantic.com/api/oauth/callback on the HighLevel app and set that exact value.',
    );
  }
  return value;
}

export function oauthClientId(env: LiveEnv): string {
  return required(env, 'GHL_CLIENT_ID', env.GHL_CLIENT_ID, MOCK_CLIENT_ID);
}

export function oauthClientSecret(env: LiveEnv): string {
  return required(env, 'GHL_CLIENT_SECRET', env.GHL_CLIENT_SECRET, MOCK_CLIENT_SECRET);
}

export function oauthUserType(env: LiveEnv): 'Location' | 'Company' {
  const value = env.GHL_USER_TYPE?.trim() || 'Location';
  if (value !== 'Location' && value !== 'Company') {
    throw new Error('GHL_USER_TYPE must be Location or Company.');
  }
  return value;
}

export function encryptionKey(env: LiveEnv): string {
  const value = required(env, 'TOKEN_ENCRYPTION_KEY', env.TOKEN_ENCRYPTION_KEY, DEMO_ENCRYPTION_KEY_B64);
  if (isLive(env) && value === DEMO_ENCRYPTION_KEY_B64) {
    throw new Error('Refusing to start live mode with the demo encryption key.');
  }
  return value;
}

export function metaVerifyToken(env: LiveEnv): string {
  return required(env, 'META_VERIFY_TOKEN', env.META_VERIFY_TOKEN, MOCK_META_VERIFY_TOKEN);
}

export function metaAppSecret(env: LiveEnv): string {
  return required(env, 'META_APP_SECRET', env.META_APP_SECRET, MOCK_META_APP_SECRET);
}

export function formWebhookSecret(env: LiveEnv): string {
  return required(env, 'FORM_WEBHOOK_SECRET', env.FORM_WEBHOOK_SECRET, MOCK_FORM_SECRET);
}

export function leadConnectorBaseUrl(env: LiveEnv): string {
  if (!isLive(env)) return 'https://mock.internal';
  const value = env.GHL_BASE_URL?.trim() ?? '';
  if (!value) throw new Error('GHL_BASE_URL is required in live mode.');
  return value.replace(/\/$/, '');
}

/**
 * Prefer the location on the token response. LOCATION_ID is only the fallback.
 * Live installs do not need a pre-set location.
 */
export function locationFromInstall(tokenLocationId: string | undefined, configuredLocationId: string | undefined): string {
  const fromToken = tokenLocationId?.trim() ?? '';
  if (fromToken) return fromToken;
  const configured = configuredLocationId?.trim() ?? '';
  if (configured) return configured;
  throw new Error('The token response had no locationId and LOCATION_ID is unset.');
}

/** First four hextets of an IPv6 address, so one /64 shares a rate-limit bucket. IPv4 is unchanged. */
export function rateLimitKey(ip: string): string {
  const trimmed = ip.trim();
  if (!trimmed) return 'unknown';
  if (trimmed.includes('.')) {
    const mapped = /^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(trimmed);
    if (mapped?.[1]) return mapped[1];
    if (!trimmed.includes(':')) return trimmed;
  }
  const groups = expandIpv6(trimmed);
  if (!groups) return trimmed.toLowerCase();
  return `${groups.slice(0, 4).join(':')}::/64`;
}

function expandIpv6(input: string): string[] | null {
  const bare = (input.split('%')[0] ?? '').toLowerCase();
  if (!bare.includes(':') || bare.includes('.')) return null;
  const halves = bare.split('::');
  if (halves.length > 2) return null;
  const parse = (part: string) => (part ? part.split(':').filter(Boolean) : []);
  const left = parse(halves[0] ?? '');
  const right = halves.length === 2 ? parse(halves[1] ?? '') : [];
  if (halves.length === 1) {
    if (left.length !== 8) return null;
    return left.map(padGroup);
  }
  const missing = 8 - left.length - right.length;
  if (missing < 0) return null;
  return [...left, ...Array.from({ length: missing }, () => '0'), ...right].map(padGroup);
}

function padGroup(part: string): string {
  return part.padStart(4, '0');
}
