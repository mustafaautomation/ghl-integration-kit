CREATE TABLE installations (
  location_id TEXT PRIMARY KEY,
  company_id TEXT,
  user_id TEXT,
  user_type TEXT NOT NULL,
  access_token_enc TEXT NOT NULL,
  refresh_token_enc TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  scope TEXT NOT NULL,
  uninstalled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE oauth_states (
  state TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
--> statement-breakpoint
CREATE TABLE webhook_events (
  event_id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  received_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE webhook_inspections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  event_id TEXT,
  signature_valid INTEGER NOT NULL,
  idempotent_hit INTEGER NOT NULL DEFAULT 0,
  status_code INTEGER NOT NULL,
  reason TEXT,
  raw_body TEXT NOT NULL,
  headers TEXT NOT NULL,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE leads (
  id TEXT PRIMARY KEY,
  correlation_id TEXT NOT NULL,
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL DEFAULT '',
  email TEXT,
  phone_e164 TEXT,
  custom TEXT NOT NULL,
  tags TEXT NOT NULL,
  attribution TEXT NOT NULL,
  status TEXT NOT NULL,
  contact_id TEXT,
  opportunity_id TEXT,
  appointment_id TEXT,
  sms_message_id TEXT,
  email_message_id TEXT,
  raw TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE lead_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX lead_events_lead_id_idx ON lead_events (lead_id, id);
--> statement-breakpoint
CREATE TABLE identities (
  key TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL,
  opportunity_id TEXT,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE offered_slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id TEXT NOT NULL,
  start_time TEXT NOT NULL,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX offered_slots_lead_id_idx ON offered_slots (lead_id, id);
--> statement-breakpoint
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL,
  run_at INTEGER NOT NULL,
  last_error TEXT,
  correlation_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX jobs_pending_idx ON jobs (status, run_at, created_at);
--> statement-breakpoint
CREATE TABLE rate_limits (
  ip TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (ip, window_start)
);
