import { describe, expect, it } from 'vitest';
import { fieldMapSchema, type FieldMap } from '../mapping/fields.js';
import {
  isMissedCallEvent,
  isUninstallEvent,
  MetaLeadSource,
  parseMissedCall,
  sampleMetaLead,
  signFormBody,
  signMetaBody,
  WebsiteFormSource,
} from './sources.js';

const fieldMap: FieldMap = fieldMapSchema.parse({
  meta: {
    full_name: { to: 'name' },
    email: { to: 'email' },
    phone_number: { to: 'phone' },
    interested_in: { to: 'custom', key: 'interest' },
  },
  website_form: {
    first_name: { to: 'firstName' },
    last_name: { to: 'lastName' },
    email: { to: 'email' },
    phone: { to: 'phone' },
    service: { to: 'custom', key: 'interest' },
    page: { to: 'custom', key: 'landing_page' },
  },
  missed_call: {
    name: { to: 'name' },
    email: { to: 'email' },
    phone: { to: 'phone' },
  },
});

describe('Meta lead source', () => {
  const source = new MetaLeadSource({ appSecret: 'meta-secret', verifyToken: 'verify-me', fieldMap });

  it('answers the verify-token handshake and rejects a bad token', () => {
    const ok = source.verifyHandshake(new URLSearchParams('hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=99'));
    expect(ok).toEqual({ status: 200, body: '99' });
    const bad = source.verifyHandshake(new URLSearchParams('hub.mode=subscribe&hub.verify_token=nope&hub.challenge=99'));
    expect(bad.status).toBe(403);
  });

  it('checks the HMAC and normalises the sample lead', () => {
    const sample = sampleMetaLead(new Date('2026-11-15T12:00:00.000Z'));
    const rawBody = JSON.stringify(sample.raw);
    const headers = { 'x-hub-signature-256': signMetaBody(rawBody, 'meta-secret') };
    expect(source.verify({ rawBody, headers }).ok).toBe(true);
    expect(source.verify({ rawBody, headers: { 'x-hub-signature-256': 'sha256=deadbeef' } }).reason).toBe('mismatch');
    expect(source.verify({ rawBody, headers: {} }).reason).toBe('missing');
    const [lead] = source.parse(sample.raw, new Date('2026-11-15T12:00:00.000Z'));
    expect(lead).toMatchObject({
      source: 'meta',
      firstName: 'Jordan',
      lastName: 'Hale',
      email: 'jordan.hale@example.com',
      phoneE164: '+12025550148',
      custom: { interest: 'A first consult' },
      attribution: { source: 'Meta Lead Ads', adId: 'ad_5550199' },
    });
  });

  it('rejects a lead with neither email nor phone', () => {
    expect(() =>
      source.parse(
        {
          entry: [
            {
              changes: [
                {
                  field: 'leadgen',
                  value: { leadgen_id: 'x', field_data: [{ name: 'full_name', values: ['No Contact'] }] },
                },
              ],
            },
          ],
        },
        new Date(),
      ),
    ).toThrow();
  });
});

describe('website form source', () => {
  const source = new WebsiteFormSource({ secret: 'form-secret', fieldMap });
  const raw = {
    id: 'form_evt_1',
    submittedAt: '2026-11-15T12:00:00.000Z',
    first_name: 'Priya',
    last_name: 'Shah',
    email: 'priya.shah@example.com',
    phone: '415-555-0134',
    service: 'Brand workshop',
    page: 'https://example.com/start',
    utm_campaign: 'spring',
  };

  it('verifies the HMAC and maps fields', () => {
    const rawBody = JSON.stringify(raw);
    expect(source.verify({ rawBody, headers: { 'x-form-signature': signFormBody(rawBody, 'form-secret') } }).ok).toBe(true);
    expect(source.verify({ rawBody, headers: { 'x-form-signature': signFormBody(rawBody, 'other') } }).ok).toBe(false);
    const [lead] = source.parse(raw, new Date('2026-11-15T12:00:01.000Z'));
    expect(lead?.phoneE164).toBe('+14155550134');
    expect(lead?.custom.landing_page).toBe('https://example.com/start');
    expect(lead?.attribution.campaign).toBe('spring');
  });
});

describe('missed call', () => {
  it('recognises a missed inbound call and a phone uninstall', () => {
    expect(isMissedCallEvent({ type: 'InboundCall', data: { callStatus: 'no-answer' } })).toBe(true);
    expect(isMissedCallEvent({ type: 'InboundMessage', messageType: 'CALL', status: 'voicemail' })).toBe(true);
    expect(isMissedCallEvent({ type: 'InboundMessage', messageType: 'SMS', status: 'missed' })).toBe(false);
    expect(isUninstallEvent('UNINSTALL')).toBe(true);
    expect(isUninstallEvent('ContactCreate')).toBe(false);
  });

  it('normalises the caller', () => {
    const lead = parseMissedCall(
      { from: '+1 312-555-0176', contactName: 'Sam Okonkwo', email: 'sam.okonkwo@example.com', callId: 'call_1' },
      new Date('2026-11-15T12:00:00.000Z'),
      fieldMap,
    );
    expect(lead).toMatchObject({
      source: 'missed_call',
      firstName: 'Sam',
      lastName: 'Okonkwo',
      phoneE164: '+13125550176',
      externalId: 'call_1',
    });
  });
});
