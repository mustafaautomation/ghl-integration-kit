import { D1Queue, D1Store } from '@ghl/db/d1';
import {
  DEFAULT_SCOPES,
  GhlAdapter,
  LEADCONNECTOR_VERSION,
  MetaLeadSource,
  OAuthClient,
  TokenService,
  WebsiteFormSource,
  checkOauthState,
  createOauthState,
  documentedWebhookKeys,
  fieldMapSchema,
  parseEncryptionKey,
  type AppLogger,
  type FlowDeps,
  type WebhookKeys,
} from '@ghl/domain/edge';
import fieldIdsJson from '../../../config/custom-field-ids.json';
import fieldMapJson from '../../../config/field-map.json';
import type { Env } from './env.js';
import { TEST_ED25519_PUBLIC_KEY, TEST_RSA_PUBLIC_KEY } from './keys.js';
import {
  encryptionKey,
  formWebhookSecret,
  isLive,
  leadConnectorBaseUrl,
  locationFromInstall,
  metaAppSecret,
  metaVerifyToken,
  oauthClientId,
  oauthClientSecret,
  oauthRedirectUri,
  oauthUserType,
} from './live.js';

const fieldMap = fieldMapSchema.parse(fieldMapJson);
const fieldIds = fieldIdsJson;

export function isMock(env: Env): boolean {
  return !isLive(env);
}

export function baseUrl(env: Env): string {
  return leadConnectorBaseUrl(env);
}

export async function resolveLocationId(env: Env, store: D1Store): Promise<string> {
  const configured = env.LOCATION_ID?.trim();
  if (configured) return configured;
  const installed = await store.latestActive();
  if (installed) return installed.locationId;
  if (!isLive(env)) return 'loc_northwind_555';
  throw new Error('No installed location. Open /api/oauth/install or set LOCATION_ID.');
}

export function webhookKeys(env: Env): WebhookKeys {
  if (!isMock(env)) return documentedWebhookKeys();
  return { ed25519Pem: TEST_ED25519_PUBLIC_KEY, rsaPem: TEST_RSA_PUBLIC_KEY };
}

export function mockFetch(env: Env): typeof fetch {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.hostname !== 'mock.internal') return fetch(request);
    const stub = env.MOCK.get(env.MOCK.idFromName('northwind'));
    return stub.fetch(request);
  };
}

function silentLog(): AppLogger {
  const log = {
    level: 'silent',
    info() {},
    error() {},
    warn() {},
    debug() {},
    fatal() {},
    trace() {},
    silent() {},
    child() {
      return log;
    },
  };
  return log as unknown as AppLogger;
}

export function createServices(env: Env) {
  const fetchImpl = isMock(env) ? mockFetch(env) : fetch;
  const store = new D1Store(env.DB);
  const queue = new D1Queue(env.DB, env.JOBS, {
    maxAttempts: Number(env.QUEUE_MAX_ATTEMPTS) || 5,
    baseMs: 500,
    maxMs: 30_000,
    jitterRatio: 0,
  });
  const redirectUri = oauthRedirectUri(env);
  const userType = oauthUserType(env);
  const clientId = oauthClientId(env);
  const clientSecret = oauthClientSecret(env);
  const oauth = new OAuthClient({
    tokenUrl: `${baseUrl(env)}/oauth/token`,
    clientId,
    clientSecret,
    redirectUri,
    userType,
    fetchImpl,
  });
  const tokens = new TokenService(store, oauth, parseEncryptionKey(encryptionKey(env)), 300_000);
  const locationId = async () => {
    const id = await resolveLocationId(env, store);
    return id;
  };
  const crm = new GhlAdapter({
    baseUrl: baseUrl(env),
    locationId: env.LOCATION_ID?.trim() || 'loc_northwind_555',
    getLocationId: locationId,
    getToken: async () => tokens.getValidAccessToken(await locationId()),
    fieldIds,
    fetchImpl,
  });
  const meta = new MetaLeadSource({ appSecret: metaAppSecret(env), verifyToken: metaVerifyToken(env), fieldMap });
  const forms = new WebsiteFormSource({ secret: formWebhookSecret(env), fieldMap });
  return { store, queue, oauth, tokens, crm, meta, forms, fetchImpl, redirectUri, userType, clientId, fieldMap };
}

export type Services = ReturnType<typeof createServices>;

export function flowDeps(env: Env, services: Services): FlowDeps {
  return {
    crm: services.crm,
    leads: {
      get: (id) => services.store.getLead(id),
      save: (lead) => services.store.saveLead(lead),
      addEvent: (leadId, event) => services.store.addEvent(leadId, event),
      findIdentity: (email, phone) => services.store.findIdentity(email, phone),
      rememberIdentity: (email, phone, contactId, opportunityId) =>
        services.store.rememberIdentity(email, phone, contactId, opportunityId),
      saveSlots: (leadId, slots) => services.store.saveSlots(leadId, slots),
    },
    log: silentLog(),
    businessName: env.BUSINESS_NAME,
    pipelineId: env.PIPELINE_ID,
    stageNew: env.PIPELINE_STAGE_NEW,
    stageBooked: env.PIPELINE_STAGE_BOOKED,
    calendarId: env.CALENDAR_ID,
    timezone: env.TIMEZONE,
    stepDelayMs: 0,
  };
}

let boot: Promise<void> | null = null;

export function ensureInstalled(env: Env): Promise<void> {
  if (!isMock(env)) return Promise.resolve();
  boot ??= installMock(env).catch((error: unknown) => {
    boot = null;
    throw error;
  });
  return boot;
}

async function installMock(env: Env): Promise<void> {
  const services = createServices(env);
  const locationId = await resolveLocationId(env, services.store);
  const existing = await services.store.get(locationId);
  if (existing && !existing.uninstalledAt) {
    const token = await services.tokens.getValidAccessToken(locationId).catch(() => '');
    const res = token
      ? await services.fetchImpl(new URL(`/locations/${locationId}`, `${baseUrl(env)}/`), {
          headers: { Authorization: `Bearer ${token}`, Version: LEADCONNECTOR_VERSION, Accept: 'application/json' },
        })
      : null;
    if (res?.ok) return;
    await services.tokens.markUninstalled(locationId);
  }
  const created = createOauthState(new Date(), 600_000);
  await services.store.insertState(created.state, created.expiresAt);
  const authorize = new URL('/oauth/chooselocation', `${baseUrl(env)}/`);
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('client_id', services.clientId);
  authorize.searchParams.set('redirect_uri', services.redirectUri);
  authorize.searchParams.set('scope', DEFAULT_SCOPES.join(' '));
  authorize.searchParams.set('state', created.state);
  authorize.searchParams.set('format', 'json');
  const issued = await services.fetchImpl(authorize);
  if (!issued.ok) throw new Error(`mock_install_failed_${issued.status}`);
  const body = (await issued.json()) as { code?: string };
  if (!body.code) throw new Error('mock_install_missing_code');
  const verdict = checkOauthState(await services.store.takeState(created.state), new Date());
  if (verdict !== 'ok') throw new Error(`state_${verdict}`);
  await services.store.markStateUsed(created.state, new Date());
  const exchanged = await services.oauth.exchange(body.code);
  await services.tokens.saveFromTokenResponse(exchanged, locationFromInstall(exchanged.locationId, env.LOCATION_ID));
}

export function resetInstallCache(): void {
  boot = null;
}
