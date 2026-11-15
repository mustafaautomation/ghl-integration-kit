import type { JobMessage } from '@ghl/db/d1';

export interface Env {
  DB: D1Database;
  MOCK: DurableObjectNamespace;
  JOBS: Queue<JobMessage>;
  ASSETS: Fetcher;
  GHL_MODE: string;
  GHL_CLIENT_ID?: string;
  GHL_CLIENT_SECRET?: string;
  GHL_REDIRECT_URI?: string;
  GHL_USER_TYPE?: string;
  GHL_BASE_URL?: string;
  GHL_OAUTH_AUTHORIZE_URL?: string;
  META_VERIFY_TOKEN?: string;
  META_APP_SECRET?: string;
  FORM_WEBHOOK_SECRET?: string;
  TOKEN_ENCRYPTION_KEY?: string;
  BUSINESS_NAME: string;
  LOCATION_ID?: string;
  COMPANY_ID: string;
  USER_ID: string;
  PIPELINE_ID: string;
  PIPELINE_STAGE_NEW: string;
  PIPELINE_STAGE_BOOKED: string;
  CALENDAR_ID: string;
  TIMEZONE: string;
  RATE_LIMIT_MAX: string;
  RATE_LIMIT_WINDOW_MS: string;
  QUEUE_MAX_ATTEMPTS: string;
  BODY_LIMIT_BYTES: string;
}
