import { decryptString, encryptString } from '../crypto/aes-gcm.js';
import { expiryFromExpiresIn, needsRefresh, type OAuthClient, type TokenResponse } from './oauth.js';

export interface InstallationRecord {
  locationId: string;
  companyId?: string;
  userId?: string;
  userType: 'Location' | 'Company';
  accessTokenEnc: string;
  refreshTokenEnc: string;
  expiresAt: Date;
  scope: string;
  uninstalledAt: Date | null;
}

export interface InstallationStore {
  get(locationId: string): Promise<InstallationRecord | null>;
  save(record: InstallationRecord): Promise<void>;
}

export class NotInstalledError extends Error {
  constructor(locationId: string) {
    super(`not_installed:${locationId}`);
    this.name = 'NotInstalledError';
  }
}

export class TokenService {
  private readonly inflight = new Map<string, Promise<string>>();

  constructor(
    private readonly store: InstallationStore,
    private readonly client: OAuthClient,
    private readonly key: Buffer,
    private readonly skewMs: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async saveFromTokenResponse(tokens: TokenResponse, locationId: string): Promise<void> {
    const resolvedLocation = tokens.locationId ?? locationId;
    await this.store.save({
      locationId: resolvedLocation,
      companyId: tokens.companyId,
      userId: tokens.userId,
      userType: tokens.userType,
      accessTokenEnc: encryptString(tokens.access_token, this.key),
      refreshTokenEnc: encryptString(tokens.refresh_token, this.key),
      expiresAt: expiryFromExpiresIn(tokens.expires_in, this.now()),
      scope: tokens.scope,
      uninstalledAt: null,
    });
  }

  async markUninstalled(locationId: string): Promise<void> {
    const row = await this.store.get(locationId);
    if (!row) return;
    await this.store.save({ ...row, uninstalledAt: this.now() });
  }

  getValidAccessToken(locationId: string): Promise<string> {
    const existing = this.inflight.get(locationId);
    if (existing) return existing;
    const pending = this.resolve(locationId).finally(() => {
      this.inflight.delete(locationId);
    });
    this.inflight.set(locationId, pending);
    return pending;
  }

  private async resolve(locationId: string): Promise<string> {
    const row = await this.store.get(locationId);
    if (!row || row.uninstalledAt) {
      throw new NotInstalledError(locationId);
    }
    if (!needsRefresh(row.expiresAt, this.now(), this.skewMs)) {
      return decryptString(row.accessTokenEnc, this.key);
    }
    const refreshToken = decryptString(row.refreshTokenEnc, this.key);
    const next = await this.client.refresh(refreshToken);
    await this.saveFromTokenResponse(next, locationId);
    return next.access_token;
  }
}
