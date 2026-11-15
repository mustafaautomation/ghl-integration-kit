import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { applyFieldMap, type FieldMap } from '../mapping/fields.js';
import { toE164 } from './phone.js';
import { parseNormalizedLead, type LeadSourceId, type NormalizedLead } from './schema.js';

export interface HeaderMap {
  [key: string]: string | undefined;
}

export interface VerifyResult {
  ok: boolean;
  reason?: string;
}

export interface HandshakeResult {
  status: number;
  body: string;
}

/**
 * A lead source checks its own request and turns the payload into normalised leads.
 * Signature checks stay on the raw body.
 */
export interface LeadSource {
  readonly id: LeadSourceId;
  verifyHandshake?(query: URLSearchParams): HandshakeResult;
  verify(input: { rawBody: string; headers: HeaderMap }): VerifyResult;
  parse(raw: unknown, receivedAt: Date): NormalizedLead[];
}

function hmacSha256(raw: string, secret: string): string {
  return createHmac('sha256', secret).update(raw).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function signMetaBody(raw: string, appSecret: string): string {
  return `sha256=${hmacSha256(raw, appSecret)}`;
}

export function signFormBody(raw: string, secret: string): string {
  return `sha256=${hmacSha256(raw, secret)}`;
}

const metaPayloadSchema = z.object({
  object: z.string().optional(),
  entry: z.array(
    z.object({
      id: z.string().optional(),
      time: z.number().optional(),
      changes: z.array(
        z.object({
          field: z.string(),
          value: z.object({
            leadgen_id: z.string().min(1),
            form_id: z.string().optional(),
            ad_id: z.string().optional(),
            created_time: z.number().optional(),
            field_data: z.array(z.object({ name: z.string(), values: z.array(z.string()) })).default([]),
          }),
        }),
      ),
    }),
  ),
});

export class MetaLeadSource implements LeadSource {
  readonly id = 'meta' as const;

  constructor(
    private readonly opts: {
      appSecret: string;
      verifyToken: string;
      fieldMap: FieldMap;
    },
  ) {}

  verifyHandshake(query: URLSearchParams): HandshakeResult {
    const mode = query.get('hub.mode');
    const token = query.get('hub.verify_token');
    const challenge = query.get('hub.challenge');
    if (mode === 'subscribe' && token === this.opts.verifyToken && challenge) {
      return { status: 200, body: challenge };
    }
    return { status: 403, body: 'forbidden' };
  }

  verify(input: { rawBody: string; headers: HeaderMap }): VerifyResult {
    const header = input.headers['x-hub-signature-256'];
    if (!header) return { ok: false, reason: 'missing' };
    const expected = signMetaBody(input.rawBody, this.opts.appSecret);
    if (!safeEqual(header, expected)) return { ok: false, reason: 'mismatch' };
    return { ok: true };
  }

  parse(raw: unknown, receivedAt: Date): NormalizedLead[] {
    const payload = metaPayloadSchema.parse(raw);
    const leads: NormalizedLead[] = [];
    for (const entry of payload.entry) {
      for (const change of entry.changes) {
        if (change.field !== 'leadgen') continue;
        const fields: Record<string, string> = {};
        for (const item of change.value.field_data) {
          const value = item.values[0];
          if (value) fields[item.name] = value;
        }
        const mapped = applyFieldMap('meta', fields, this.opts.fieldMap);
        leads.push(
          parseNormalizedLead({
            source: 'meta',
            externalId: change.value.leadgen_id,
            firstName: mapped.firstName || 'Unknown',
            lastName: mapped.lastName,
            email: mapped.email,
            phoneE164: toE164(mapped.phoneRaw) ?? undefined,
            custom: mapped.custom,
            tags: ['meta-lead', 'speed-to-lead'],
            attribution: {
              source: 'Meta Lead Ads',
              medium: 'paid',
              campaign: change.value.ad_id,
              adId: change.value.ad_id,
            },
            receivedAt: receivedAt.toISOString(),
          }),
        );
      }
    }
    return leads;
  }
}

const formPayloadSchema = z.object({
  id: z.string().min(1),
  submittedAt: z.string().datetime(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  service: z.string().optional(),
  page: z.string().optional(),
  utm_source: z.string().optional(),
  utm_medium: z.string().optional(),
  utm_campaign: z.string().optional(),
});

export class WebsiteFormSource implements LeadSource {
  readonly id = 'website_form' as const;

  constructor(
    private readonly opts: {
      secret: string;
      fieldMap: FieldMap;
    },
  ) {}

  verify(input: { rawBody: string; headers: HeaderMap }): VerifyResult {
    const header = input.headers['x-form-signature'];
    if (!header) return { ok: false, reason: 'missing' };
    const expected = signFormBody(input.rawBody, this.opts.secret);
    if (!safeEqual(header, expected)) return { ok: false, reason: 'mismatch' };
    return { ok: true };
  }

  parse(raw: unknown, receivedAt: Date): NormalizedLead[] {
    const payload = formPayloadSchema.parse(raw);
    const mapped = applyFieldMap(
      'website_form',
      {
        first_name: payload.first_name ?? '',
        last_name: payload.last_name ?? '',
        email: payload.email ?? '',
        phone: payload.phone ?? '',
        service: payload.service ?? '',
        page: payload.page ?? '',
      },
      this.opts.fieldMap,
    );
    return [
      parseNormalizedLead({
        source: 'website_form',
        externalId: payload.id,
        firstName: mapped.firstName || 'Unknown',
        lastName: mapped.lastName,
        email: mapped.email,
        phoneE164: toE164(mapped.phoneRaw) ?? undefined,
        custom: mapped.custom,
        tags: ['website-form', 'speed-to-lead'],
        attribution: {
          source: 'Website form',
          medium: payload.utm_medium ?? 'web',
          campaign: payload.utm_campaign ?? payload.utm_source,
        },
        receivedAt: receivedAt.toISOString(),
      }),
    ];
  }
}

const missedCallSchema = z.object({
  from: z.string().min(1),
  email: z.string().optional(),
  contactName: z.string().optional(),
  callId: z.string().optional(),
});

export function parseMissedCall(raw: unknown, receivedAt: Date, fieldMap: FieldMap): NormalizedLead {
  const data = missedCallSchema.parse(raw);
  const mapped = applyFieldMap(
    'missed_call',
    {
      name: data.contactName ?? '',
      email: data.email ?? '',
      phone: data.from,
    },
    fieldMap,
  );
  const phone = toE164(mapped.phoneRaw ?? data.from);
  return parseNormalizedLead({
    source: 'missed_call',
    externalId: data.callId ?? `call_${phone ?? data.from}`,
    firstName: mapped.firstName || 'Caller',
    lastName: mapped.lastName,
    email: mapped.email,
    phoneE164: phone ?? undefined,
    custom: mapped.custom,
    tags: ['missed-call'],
    attribution: { source: 'Missed call', medium: 'phone' },
    receivedAt: receivedAt.toISOString(),
  });
}

const MISSED_STATUSES = new Set(['missed', 'no-answer', 'no_answer', 'voicemail', 'unanswered', 'failed']);

export function isMissedCallEvent(body: { type?: string; data?: Record<string, unknown>; messageType?: string; status?: string }): boolean {
  const type = body.type ?? '';
  const data = body.data ?? {};
  const status = String(data.callStatus ?? data.status ?? body.status ?? '').toLowerCase();
  const messageType = String(data.messageType ?? body.messageType ?? '').toUpperCase();
  if (type === 'InboundCall' || type === 'CallStatus') {
    return MISSED_STATUSES.has(status) || status === '';
  }
  if (type === 'InboundMessage' && messageType === 'CALL') {
    return MISSED_STATUSES.has(status);
  }
  return false;
}

export function isUninstallEvent(type: string | undefined): boolean {
  return type === 'UNINSTALL' || type === 'AppUninstall';
}

export function sampleMetaLead(now: Date): { raw: Record<string, unknown>; externalId: string } {
  const externalId = `leadgen_${now.getTime()}`;
  return {
    externalId,
    raw: {
      object: 'page',
      entry: [
        {
          id: 'page_555',
          time: Math.floor(now.getTime() / 1000),
          changes: [
            {
              field: 'leadgen',
              value: {
                leadgen_id: externalId,
                page_id: 'page_555',
                form_id: 'form_555',
                created_time: Math.floor(now.getTime() / 1000),
                ad_id: 'ad_5550199',
                field_data: [
                  { name: 'full_name', values: ['Jordan Hale'] },
                  { name: 'email', values: ['jordan.hale@example.com'] },
                  { name: 'phone_number', values: ['+1 202-555-0148'] },
                  { name: 'interested_in', values: ['A first consult'] },
                ],
              },
            },
          ],
        },
      ],
    },
  };
}
