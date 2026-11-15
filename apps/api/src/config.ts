import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_SCOPES,
  DEMO_ENCRYPTION_KEY_B64,
  documentedWebhookKeys,
  fieldMapSchema,
  type FieldMap,
  type WebhookKeys,
} from '@ghl/domain';
import { z } from 'zod';

const envSchema = z.object({
  GHL_MODE: z.enum(['mock', 'live']).default('mock'),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1),
  QUEUE_DB_PATH: z.string().default('./data/queue.sqlite'),
  LOG_LEVEL: z.string().default('info'),
  CONSOLE_ORIGIN: z.string().default('http://localhost:3000'),
  TOKEN_ENCRYPTION_KEY: z.string().min(1),
  GHL_BASE_URL: z.string().url(),
  GHL_OAUTH_AUTHORIZE_URL: z.string().url(),
  GHL_CLIENT_ID: z.string().min(1),
  GHL_CLIENT_SECRET: z.string().min(1),
  GHL_REDIRECT_URI: z.string().url(),
  GHL_USER_TYPE: z.enum(['Location', 'Company']).default('Location'),
  GHL_SCOPES: z.string().optional(),
  GHL_ED25519_PUBLIC_KEY: z.string().optional(),
  GHL_RSA_PUBLIC_KEY: z.string().optional(),
  KEY_DIR: z.string().optional(),
  WEBHOOK_TIMESTAMP_WINDOW_MS: z.coerce.number().int().positive().default(300_000),
  META_VERIFY_TOKEN: z.string().min(1),
  META_APP_SECRET: z.string().min(1),
  FORM_WEBHOOK_SECRET: z.string().min(1),
  BUSINESS_NAME: z.string().default('Northwind Studio'),
  LOCATION_ID: z.string().default('loc_northwind_555'),
  PIPELINE_ID: z.string().default('pipe_new_leads'),
  PIPELINE_STAGE_NEW: z.string().default('stage_new'),
  PIPELINE_STAGE_BOOKED: z.string().default('stage_booked'),
  CALENDAR_ID: z.string().default('cal_intro'),
  TIMEZONE: z.string().default('America/New_York'),
  TOKEN_REFRESH_SKEW_MS: z.coerce.number().int().nonnegative().default(300_000),
  OAUTH_STATE_TTL_MS: z.coerce.number().int().positive().default(600_000),
  QUEUE_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  QUEUE_BASE_BACKOFF_MS: z.coerce.number().int().positive().default(500),
  QUEUE_MAX_BACKOFF_MS: z.coerce.number().int().positive().default(30_000),
  QUEUE_JITTER_RATIO: z.coerce.number().nonnegative().default(0.2),
  QUEUE_POLL_MS: z.coerce.number().int().positive().default(200),
  DEMO_STEP_DELAY_MS: z.coerce.number().int().nonnegative().default(0),
  FIELD_MAP_PATH: z.string().default('config/field-map.json'),
  CUSTOM_FIELD_IDS_PATH: z.string().default('config/custom-field-ids.json'),
});

export interface AppConfig {
  mode: 'mock' | 'live';
  port: number;
  host: string;
  databaseUrl: string;
  queueDbPath: string;
  logLevel: string;
  consoleOrigin: string;
  tokenEncryptionKey: string;
  ghlBaseUrl: string;
  authorizeUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  userType: 'Location' | 'Company';
  scopes: string[];
  keys: WebhookKeys;
  timestampWindowMs: number;
  metaVerifyToken: string;
  metaAppSecret: string;
  formWebhookSecret: string;
  businessName: string;
  locationId: string;
  pipelineId: string;
  stageNew: string;
  stageBooked: string;
  calendarId: string;
  timezone: string;
  refreshSkewMs: number;
  stateTtlMs: number;
  queueMaxAttempts: number;
  queueBaseMs: number;
  queueMaxMs: number;
  queueJitter: number;
  queuePollMs: number;
  stepDelayMs: number;
  fieldMap: FieldMap;
  fieldIds: Record<string, string>;
}

function pem(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/\\n/g, '\n');
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid environment: ${details}`);
  }
  const raw = parsed.data;
  if (raw.GHL_MODE === 'live' && raw.TOKEN_ENCRYPTION_KEY === DEMO_ENCRYPTION_KEY_B64) {
    throw new Error('Refusing to start live mode with the demo encryption key. Set TOKEN_ENCRYPTION_KEY to your own 32-byte base64 key.');
  }
  const keyDir = raw.KEY_DIR ?? path.resolve(process.cwd(), 'keys/test');
  const documented = documentedWebhookKeys();
  const keys: WebhookKeys =
    raw.GHL_MODE === 'mock'
      ? {
          ed25519Pem: readFileSync(path.join(keyDir, 'ed25519-public.pem'), 'utf8'),
          rsaPem: readFileSync(path.join(keyDir, 'rsa-public.pem'), 'utf8'),
        }
      : {
          ed25519Pem: pem(raw.GHL_ED25519_PUBLIC_KEY) ?? documented.ed25519Pem,
          rsaPem: pem(raw.GHL_RSA_PUBLIC_KEY) ?? documented.rsaPem,
        };
  const fieldMap = fieldMapSchema.parse(JSON.parse(readFileSync(path.resolve(raw.FIELD_MAP_PATH), 'utf8')));
  const fieldIds = z.record(z.string()).parse(JSON.parse(readFileSync(path.resolve(raw.CUSTOM_FIELD_IDS_PATH), 'utf8')));
  return {
    mode: raw.GHL_MODE,
    port: raw.PORT,
    host: raw.HOST,
    databaseUrl: raw.DATABASE_URL,
    queueDbPath: raw.QUEUE_DB_PATH,
    logLevel: raw.LOG_LEVEL,
    consoleOrigin: raw.CONSOLE_ORIGIN,
    tokenEncryptionKey: raw.TOKEN_ENCRYPTION_KEY,
    ghlBaseUrl: raw.GHL_BASE_URL.replace(/\/$/, ''),
    authorizeUrl: raw.GHL_OAUTH_AUTHORIZE_URL,
    clientId: raw.GHL_CLIENT_ID,
    clientSecret: raw.GHL_CLIENT_SECRET,
    redirectUri: raw.GHL_REDIRECT_URI,
    userType: raw.GHL_USER_TYPE,
    scopes: raw.GHL_SCOPES?.split(/\s+/).filter(Boolean) ?? [...DEFAULT_SCOPES],
    keys,
    timestampWindowMs: raw.WEBHOOK_TIMESTAMP_WINDOW_MS,
    metaVerifyToken: raw.META_VERIFY_TOKEN,
    metaAppSecret: raw.META_APP_SECRET,
    formWebhookSecret: raw.FORM_WEBHOOK_SECRET,
    businessName: raw.BUSINESS_NAME,
    locationId: raw.LOCATION_ID,
    pipelineId: raw.PIPELINE_ID,
    stageNew: raw.PIPELINE_STAGE_NEW,
    stageBooked: raw.PIPELINE_STAGE_BOOKED,
    calendarId: raw.CALENDAR_ID,
    timezone: raw.TIMEZONE,
    refreshSkewMs: raw.TOKEN_REFRESH_SKEW_MS,
    stateTtlMs: raw.OAUTH_STATE_TTL_MS,
    queueMaxAttempts: raw.QUEUE_MAX_ATTEMPTS,
    queueBaseMs: raw.QUEUE_BASE_BACKOFF_MS,
    queueMaxMs: raw.QUEUE_MAX_BACKOFF_MS,
    queueJitter: raw.QUEUE_JITTER_RATIO,
    queuePollMs: raw.QUEUE_POLL_MS,
    stepDelayMs: raw.DEMO_STEP_DELAY_MS,
    fieldMap,
    fieldIds,
  };
}
