import { describe, expect, it } from 'vitest';
import {
  MOCK_REDIRECT_URI,
  locationFromInstall,
  oauthRedirectUri,
  oauthUserType,
  rateLimitKey,
} from './live.js';

describe('live oauth settings', () => {
  it('keeps the mock callback in mock mode', () => {
    expect(oauthRedirectUri({ GHL_MODE: 'mock', GHL_REDIRECT_URI: 'https://leadrouter.squishwala.workers.dev/api/oauth/callback' })).toBe(
      MOCK_REDIRECT_URI,
    );
    expect(oauthRedirectUri({})).toBe(MOCK_REDIRECT_URI);
  });

  it('requires GHL_REDIRECT_URI in live mode', () => {
    expect(() => oauthRedirectUri({ GHL_MODE: 'live' })).toThrow(/GHL_REDIRECT_URI is required in live mode/);
    expect(() => oauthRedirectUri({ GHL_MODE: 'live', GHL_REDIRECT_URI: '   ' })).toThrow(/GHL_REDIRECT_URI is required/);
  });

  it('uses the registered live callback', () => {
    const workersDev = 'https://leadrouter.squishwala.workers.dev/api/oauth/callback';
    const custom = 'https://leads.quvantic.com/api/oauth/callback';
    expect(oauthRedirectUri({ GHL_MODE: 'live', GHL_REDIRECT_URI: workersDev })).toBe(workersDev);
    expect(oauthRedirectUri({ GHL_MODE: 'live', GHL_REDIRECT_URI: `  ${custom}  ` })).toBe(custom);
  });

  it('stores the location from the token response', () => {
    expect(locationFromInstall('loc_sandbox_1', 'loc_northwind_555')).toBe('loc_sandbox_1');
    expect(locationFromInstall('loc_sandbox_1', undefined)).toBe('loc_sandbox_1');
    expect(locationFromInstall(undefined, 'loc_northwind_555')).toBe('loc_northwind_555');
    expect(() => locationFromInstall('  ', '')).toThrow(/no locationId and LOCATION_ID is unset/);
  });

  it('accepts Location or Company', () => {
    expect(oauthUserType({})).toBe('Location');
    expect(oauthUserType({ GHL_USER_TYPE: 'Company' })).toBe('Company');
    expect(() => oauthUserType({ GHL_USER_TYPE: 'Agency' })).toThrow(/Location or Company/);
  });
});

describe('rate limit identity', () => {
  it('groups an IPv6 address by /64', () => {
    const full = '2001:db8:85a3:0:0:8a2e:370:7334';
    const compressed = '2001:db8:85a3::8a2e:370:7334';
    expect(rateLimitKey(full)).toBe('2001:0db8:85a3:0000::/64');
    expect(rateLimitKey(compressed)).toBe(rateLimitKey(full));
    expect(rateLimitKey('2001:db8:85a3:1::1')).toBe('2001:0db8:85a3:0001::/64');
  });

  it('leaves IPv4 addresses as themselves', () => {
    expect(rateLimitKey('203.0.113.10')).toBe('203.0.113.10');
    expect(rateLimitKey('::ffff:203.0.113.10')).toBe('203.0.113.10');
  });
});
