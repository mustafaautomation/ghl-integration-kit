import { describe, expect, it, vi } from 'vitest';
import type { CrmAdapter } from '../adapters/types.js';
import { createLogger } from '../logging/logger.js';
import type { NormalizedLead } from '../leads/schema.js';
import { RateLimitError } from '../queue/backoff.js';
import { bookSlot, runMissedCall, runSpeedToLead, type FlowDeps, type StoredLead } from './speed-to-lead.js';

function memoryDeps(seed: StoredLead, crm: CrmAdapter): FlowDeps & { events: Array<{ type: string; status: string }> } {
  const leads = new Map<string, StoredLead>([[seed.id, seed]]);
  const identities = new Map<string, { contactId: string; openOpportunityId?: string }>();
  const slots = new Map<string, string[]>();
  const events: Array<{ type: string; status: string }> = [];
  const deps: FlowDeps = {
    crm,
    log: createLogger('silent'),
    businessName: 'Northwind Studio',
    pipelineId: 'pipe_new_leads',
    stageNew: 'stage_new',
    stageBooked: 'stage_booked',
    calendarId: 'cal_intro',
    timezone: 'America/New_York',
    now: () => new Date('2026-11-16T15:00:00.000Z'),
    leads: {
      async get(id) {
        const lead = leads.get(id);
        if (!lead) throw new Error('missing');
        return lead;
      },
      async save(lead) {
        leads.set(lead.id, { ...lead });
      },
      async addEvent(leadId, event) {
        if (!leads.has(leadId)) throw new Error('missing');
        events.push({ type: event.type, status: event.status });
      },
      async findIdentity(email, phone) {
        if (email && identities.has(`email:${email}`)) return identities.get(`email:${email}`) ?? null;
        if (phone && identities.has(`phone:${phone}`)) return identities.get(`phone:${phone}`) ?? null;
        return null;
      },
      async rememberIdentity(email, phone, contactId, opportunityId) {
        const hit = { contactId, openOpportunityId: opportunityId };
        if (email) identities.set(`email:${email}`, hit);
        if (phone) identities.set(`phone:${phone}`, hit);
      },
      async saveSlots(leadId, values) {
        slots.set(leadId, values);
      },
    },
  };
  return Object.assign(deps, { events });
}

function lead(overrides: Partial<StoredLead> = {}): StoredLead {
  const base: NormalizedLead = {
    source: 'meta',
    externalId: 'leadgen_1',
    firstName: 'Jordan',
    lastName: 'Hale',
    email: 'jordan.hale@example.com',
    phoneE164: '+12025550148',
    custom: { interest: 'A first consult' },
    tags: ['meta-lead', 'speed-to-lead'],
    attribution: { source: 'Meta Lead Ads', medium: 'paid', adId: 'ad_5550199' },
    receivedAt: '2026-11-15T12:00:00.000Z',
  };
  return {
    ...base,
    id: 'lead_1',
    correlationId: 'lead_1',
    status: 'received',
    ...overrides,
  };
}

function fakeCrm(): CrmAdapter {
  const contacts = new Map<string, string>();
  return {
    name: 'fake',
    stub: true,
    async upsertContact(input) {
      const key = input.email ?? input.phone ?? 'x';
      const existing = contacts.get(key);
      const id = existing ?? 'contact_1';
      contacts.set(key, id);
      return {
        id,
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phone: input.phone,
        tags: input.tags,
        source: input.source,
        customFields: input.customFields,
        isNew: !existing,
      };
    },
    async sendMessage() {
      return { id: `msg_${Math.random().toString(16).slice(2)}`, conversationId: 'conv_1' };
    },
    async createOpportunity(input) {
      return {
        id: 'opp_1',
        name: input.name,
        contactId: input.contactId,
        pipelineId: input.pipelineId,
        stageId: input.stageId,
        status: input.status,
        source: input.source,
      };
    },
    async updateOpportunityStage(id, stageId) {
      return {
        id,
        name: 'Jordan Hale — A first consult',
        contactId: 'contact_1',
        pipelineId: 'pipe_new_leads',
        stageId,
        status: 'open',
      };
    },
    async getFreeSlots() {
      return [{ startTime: '2026-11-17T15:00:00.000Z' }, { startTime: '2026-11-17T16:00:00.000Z' }];
    },
    async bookAppointment(input) {
      return {
        id: 'appt_1',
        contactId: input.contactId,
        calendarId: input.calendarId,
        startTime: input.startTime,
        title: input.title,
        status: 'confirmed',
      };
    },
  };
}

describe('speed to lead', () => {
  it('upserts, texts, emails, opens an opportunity, and offers slots', async () => {
    const crm = fakeCrm();
    const deps = memoryDeps(lead(), crm);
    const result = await runSpeedToLead(deps, 'lead_1');
    expect(result.status).toBe('offered');
    expect(result.contactId).toBe('contact_1');
    expect(result.opportunityId).toBe('opp_1');
    expect(deps.events.map((item) => item.type)).toEqual([
      'upserted',
      'sms_sent',
      'email_sent',
      'opportunity_created',
      'slots_offered',
    ]);
  });

  it('does not send a second text when an open opportunity already exists', async () => {
    const crm = fakeCrm();
    const send = vi.spyOn(crm, 'sendMessage');
    const deps = memoryDeps(lead(), crm);
    await runSpeedToLead(deps, 'lead_1');
    await deps.leads.save(lead({ id: 'lead_2', correlationId: 'lead_2', externalId: 'leadgen_2' }));
    const second = await runSpeedToLead(deps, 'lead_2');
    expect(second.status).toBe('deduped');
    expect(send).toHaveBeenCalledTimes(2);
    expect(deps.events.some((item) => item.type === 'deduped')).toBe(true);
  });

  it('lets a rate limit bubble so the queue can retry, then skips the text on the next pass', async () => {
    const crm = fakeCrm();
    let calls = 0;
    crm.sendMessage = async (input) => {
      calls += 1;
      if (calls === 1) throw new RateLimitError(1000);
      return { id: input.type === 'SMS' ? 'sms_1' : 'email_1', conversationId: 'conv_1' };
    };
    const deps = memoryDeps(lead(), crm);
    await expect(runSpeedToLead(deps, 'lead_1')).rejects.toBeInstanceOf(RateLimitError);
    const saved = await deps.leads.get('lead_1');
    expect(saved.contactId).toBe('contact_1');
    expect(saved.smsMessageId).toBeUndefined();
    const done = await runSpeedToLead(deps, 'lead_1');
    expect(done.smsMessageId).toBe('sms_1');
    expect(done.status).toBe('offered');
  });

  it('books a slot and moves the stage', async () => {
    const deps = memoryDeps(lead(), fakeCrm());
    await runSpeedToLead(deps, 'lead_1');
    const booked = await bookSlot(deps, 'lead_1', '2026-11-17T15:00:00.000Z');
    expect(booked.status).toBe('booked');
    expect(booked.appointmentId).toBe('appt_1');
    expect(deps.events.map((item) => item.type)).toContain('stage_moved');
  });

  it('refuses to book before a contact exists', async () => {
    const deps = memoryDeps(lead(), fakeCrm());
    await expect(bookSlot(deps, 'lead_1', '2026-11-17T15:00:00.000Z')).rejects.toThrow(/lead_has_no_contact/);
  });
});

describe('missed call hook', () => {
  it('upserts the caller and sends one text back', async () => {
    const caller = lead({
      id: 'lead_call',
      correlationId: 'lead_call',
      source: 'missed_call',
      firstName: 'Sam',
      lastName: 'Okonkwo',
      email: 'sam.okonkwo@example.com',
      phoneE164: '+15550139900',
      tags: ['missed-call'],
      attribution: { source: 'Missed call', medium: 'phone' },
      custom: {},
    });
    const deps = memoryDeps(caller, fakeCrm());
    const result = await runMissedCall(deps, 'lead_call');
    expect(result.status).toBe('text_back');
    expect(deps.events.map((item) => item.type)).toEqual(['upserted', 'text_back']);
  });
});

describe('copy', () => {
  it('uses the business name and the interest', async () => {
    const { firstTouchSms, missedCallSms } = await import('./messages.js');
    expect(firstTouchSms('Northwind Studio', 'Jordan', 'A first consult')).toContain('Northwind Studio');
    expect(firstTouchSms('Northwind Studio', 'Jordan', 'A first consult')).toContain('A first consult');
    expect(missedCallSms('Northwind Studio', '')).toContain('sorry we missed you');
  });
});
