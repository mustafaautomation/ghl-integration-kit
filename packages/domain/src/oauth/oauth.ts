import { randomBytes } from 'node:crypto';
import { z } from 'zod';

export const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.literal('Bearer'),
  expires_in: z.number().positive(),
  refresh_token: z.string().min(1),
  scope: z.string(),
  userType: z.enum(['Location', 'Company']),
  locationId: z.string().optional(),
  companyId: z.string().optional(),
  userId: z.string().optional(),
});

export type TokenResponse = z.infer<typeof tokenResponseSchema>;

export function createOauthState(now: Date, ttlMs: number): { state: string; expiresAt: Date } {
  return {
    state: randomBytes(32).toString('base64url'),
    expiresAt: new Date(now.getTime() + ttlMs),
  };
}

export type StateCheck = 'ok' | 'missing' | 'expired' | 'used';

export function checkOauthState(
  row: { expiresAt: Date; usedAt: Date | null } | null,
  now: Date,
): StateCheck {
  if (!row) return 'missing';
  if (row.usedAt) return 'used';
  if (row.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'ok';
}

export function buildInstallUrl(opts: {
  authorizeUrl: string;
  clientId: string;
  redirectUri: string;
  scopes: readonly string[];
  state: string;
}): string {
  const url = new URL(opts.authorizeUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', opts.clientId);
  url.searchParams.set('redirect_uri', opts.redirectUri);
  url.searchParams.set('scope', opts.scopes.join(' '));
  url.searchParams.set('state', opts.state);
  return url.toString();
}

export function needsRefresh(expiresAt: Date, now: Date, skewMs: number): boolean {
  return expiresAt.getTime() - now.getTime() <= skewMs;
}

export function expiryFromExpiresIn(expiresInSec: number, now: Date): Date {
  return new Date(now.getTime() + expiresInSec * 1000);
}

export function authorizationCodeBody(input: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  userType: string;
}): URLSearchParams {
  return new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
    user_type: input.userType,
  });
}

export function refreshTokenBody(input: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  userType: string;
}): URLSearchParams {
  return new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: input.refreshToken,
    user_type: input.userType,
  });
}

export class OAuthError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`oauth_failed_${status}`);
    this.name = 'OAuthError';
    this.status = status;
  }
}

export class OAuthClient {
  constructor(
    private readonly opts: {
      tokenUrl: string;
      clientId: string;
      clientSecret: string;
      redirectUri: string;
      userType: string;
      fetchImpl?: typeof fetch;
    },
  ) {}

  exchange(code: string): Promise<TokenResponse> {
    return this.post(
      authorizationCodeBody({
        clientId: this.opts.clientId,
        clientSecret: this.opts.clientSecret,
        code,
        redirectUri: this.opts.redirectUri,
        userType: this.opts.userType,
      }),
    );
  }

  refresh(refreshToken: string): Promise<TokenResponse> {
    return this.post(
      refreshTokenBody({
        clientId: this.opts.clientId,
        clientSecret: this.opts.clientSecret,
        refreshToken,
        userType: this.opts.userType,
      }),
    );
  }

  private async post(body: URLSearchParams): Promise<TokenResponse> {
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    const res = await fetchImpl(this.opts.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body,
    });
    const json: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      throw new OAuthError(res.status);
    }
    return tokenResponseSchema.parse(json);
  }
}
