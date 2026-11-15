import { bigint, boolean, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const installations = pgTable('installations', {
  locationId: text('location_id').primaryKey(),
  companyId: text('company_id'),
  userId: text('user_id'),
  userType: text('user_type').notNull(),
  accessTokenEnc: text('access_token_enc').notNull(),
  refreshTokenEnc: text('refresh_token_enc').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  scope: text('scope').notNull(),
  uninstalledAt: timestamp('uninstalled_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const oauthStates = pgTable('oauth_states', {
  state: text('state').primaryKey(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
});

export const webhookEvents = pgTable('webhook_events', {
  eventId: text('event_id').primaryKey(),
  source: text('source').notNull(),
  status: text('status').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
});

export const webhookInspections = pgTable('webhook_inspections', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  source: text('source').notNull(),
  eventId: text('event_id'),
  signatureValid: boolean('signature_valid').notNull(),
  idempotentHit: boolean('idempotent_hit').notNull().default(false),
  statusCode: integer('status_code').notNull(),
  reason: text('reason'),
  rawBody: text('raw_body').notNull(),
  headers: jsonb('headers').$type<Record<string, string>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const leads = pgTable('leads', {
  id: text('id').primaryKey(),
  correlationId: text('correlation_id').notNull(),
  source: text('source').notNull(),
  externalId: text('external_id').notNull(),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull().default(''),
  email: text('email'),
  phoneE164: text('phone_e164'),
  custom: jsonb('custom').$type<Record<string, string>>().notNull(),
  tags: jsonb('tags').$type<string[]>().notNull(),
  attribution: jsonb('attribution').$type<{ source: string; medium?: string; campaign?: string; adId?: string }>().notNull(),
  status: text('status').notNull(),
  contactId: text('contact_id'),
  opportunityId: text('opportunity_id'),
  appointmentId: text('appointment_id'),
  smsMessageId: text('sms_message_id'),
  emailMessageId: text('email_message_id'),
  raw: jsonb('raw').$type<unknown>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const leadEvents = pgTable('lead_events', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  leadId: text('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  status: text('status').notNull(),
  detail: jsonb('detail').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const identities = pgTable('identities', {
  key: text('key').primaryKey(),
  contactId: text('contact_id').notNull(),
  opportunityId: text('opportunity_id'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const offeredSlots = pgTable('offered_slots', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  leadId: text('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
  startTime: text('start_time').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
