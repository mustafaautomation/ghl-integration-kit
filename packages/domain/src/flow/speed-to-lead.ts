import type { CrmAdapter } from '../adapters/types.js';
import type { AppLogger } from '../logging/logger.js';
import type { NormalizedLead } from '../leads/schema.js';
import { firstTouchEmail, firstTouchSms, missedCallSms } from './messages.js';

export interface StoredLead extends NormalizedLead {
  id: string;
  correlationId: string;
  status: string;
  contactId?: string;
  opportunityId?: string;
  appointmentId?: string;
  smsMessageId?: string;
  emailMessageId?: string;
}

export interface LeadEventInput {
  type: string;
  status: 'ok' | 'error' | 'skipped';
  detail?: Record<string, unknown>;
}

export interface IdentityHit {
  contactId: string;
  openOpportunityId?: string;
}

export interface FlowDeps {
  crm: CrmAdapter;
  leads: {
    get(id: string): Promise<StoredLead>;
    save(lead: StoredLead): Promise<void>;
    addEvent(leadId: string, event: LeadEventInput): Promise<void>;
    findIdentity(email?: string, phoneE164?: string): Promise<IdentityHit | null>;
    rememberIdentity(email: string | undefined, phoneE164: string | undefined, contactId: string, opportunityId?: string): Promise<void>;
    saveSlots(leadId: string, slots: string[]): Promise<void>;
  };
  log: AppLogger;
  businessName: string;
  pipelineId: string;
  stageNew: string;
  stageBooked: string;
  calendarId: string;
  timezone: string;
  now?: () => Date;
  slotWindowDays?: number;
  stepDelayMs?: number;
}

async function event(deps: FlowDeps, lead: StoredLead, type: string, status: LeadEventInput['status'], detail?: Record<string, unknown>) {
  deps.log.info({ correlationId: lead.correlationId, leadId: lead.id, step: type, status }, 'lead step');
  await deps.leads.addEvent(lead.id, { type, status, detail });
  if (deps.stepDelayMs && deps.stepDelayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, deps.stepDelayMs));
  }
}

export async function runSpeedToLead(deps: FlowDeps, leadId: string): Promise<StoredLead> {
  const lead = await deps.leads.get(leadId);
  const log = deps.log.child({ correlationId: lead.correlationId, leadId: lead.id });
  const existing = await deps.leads.findIdentity(lead.email, lead.phoneE164);

  const contact = await deps.crm.upsertContact({
    firstName: lead.firstName,
    lastName: lead.lastName,
    email: lead.email,
    phone: lead.phoneE164,
    tags: lead.tags,
    source: lead.attribution.source,
    customFields: lead.custom,
  });
  lead.contactId = contact.id;
  lead.status = 'processing';
  await deps.leads.save(lead);
  await event(deps, lead, 'upserted', 'ok', {
    contactId: contact.id,
    isNew: contact.isNew,
    request: { op: 'POST /contacts/upsert', firstName: lead.firstName, lastName: lead.lastName, email: lead.email, phone: lead.phoneE164, tags: lead.tags, customFields: lead.custom },
    response: { contactId: contact.id, isNew: contact.isNew },
  });

  if (existing?.openOpportunityId) {
    lead.opportunityId = existing.openOpportunityId;
    lead.status = 'deduped';
    await deps.leads.save(lead);
    await deps.leads.rememberIdentity(lead.email, lead.phoneE164, contact.id, existing.openOpportunityId);
    await event(deps, lead, 'deduped', 'skipped', {
      contactId: contact.id,
      opportunityId: existing.openOpportunityId,
      note: 'This person already has an open opportunity, so no second text went out.',
    });
    log.info({ step: 'deduped' }, 'skipped first touch');
    return lead;
  }

  if (!lead.smsMessageId) {
    const sms = await deps.crm.sendMessage({
      contactId: contact.id,
      type: 'SMS',
      body: firstTouchSms(deps.businessName, lead.firstName, lead.custom.interest),
    });
    lead.smsMessageId = sms.id;
    await deps.leads.save(lead);
    await event(deps, lead, 'sms_sent', 'ok', {
      messageId: sms.id,
      request: { op: 'POST /conversations/messages', type: 'SMS', contactId: contact.id },
      response: { messageId: sms.id, conversationId: sms.conversationId },
    });
  }

  if (!lead.emailMessageId && lead.email) {
    const email = firstTouchEmail(deps.businessName, lead.firstName, lead.custom.interest);
    const sent = await deps.crm.sendMessage({
      contactId: contact.id,
      type: 'Email',
      subject: email.subject,
      body: email.text,
      html: email.html,
    });
    lead.emailMessageId = sent.id;
    await deps.leads.save(lead);
    await event(deps, lead, 'email_sent', 'ok', {
      messageId: sent.id,
      request: { op: 'POST /conversations/messages', type: 'Email', contactId: contact.id, subject: email.subject },
      response: { messageId: sent.id, conversationId: sent.conversationId },
    });
  }

  if (!lead.opportunityId) {
    const opportunity = await deps.crm.createOpportunity({
      contactId: contact.id,
      name: `${lead.firstName} ${lead.lastName}`.trim() + (lead.custom.interest ? ` — ${lead.custom.interest}` : ''),
      pipelineId: deps.pipelineId,
      stageId: deps.stageNew,
      status: 'open',
      monetaryValue: 0,
      source: lead.attribution.source,
    });
    lead.opportunityId = opportunity.id;
    await deps.leads.save(lead);
    await event(deps, lead, 'opportunity_created', 'ok', {
      opportunityId: opportunity.id,
      stageId: opportunity.stageId,
      request: { op: 'POST /opportunities/', contactId: contact.id, pipelineId: deps.pipelineId, stageId: deps.stageNew },
      response: { opportunityId: opportunity.id, stageId: opportunity.stageId, status: opportunity.status },
    });
  }

  const now = deps.now?.() ?? new Date();
  const windowDays = deps.slotWindowDays ?? 7;
  const slots = await deps.crm.getFreeSlots({
    calendarId: deps.calendarId,
    startMs: now.getTime(),
    endMs: now.getTime() + windowDays * 86_400_000,
    timezone: deps.timezone,
  });
  const times = slots.slice(0, 6).map((slot) => slot.startTime);
  await deps.leads.saveSlots(lead.id, times);
  lead.status = 'offered';
  await deps.leads.save(lead);
  await deps.leads.rememberIdentity(lead.email, lead.phoneE164, contact.id, lead.opportunityId);
  await event(deps, lead, 'slots_offered', 'ok', {
    slots: times,
    request: { op: 'GET /calendars/{id}/free-slots', calendarId: deps.calendarId, timezone: deps.timezone },
    response: { slots: times },
  });
  return lead;
}

export async function bookSlot(deps: FlowDeps, leadId: string, startTime: string): Promise<StoredLead> {
  const lead = await deps.leads.get(leadId);
  if (!lead.contactId) {
    throw new Error('lead_has_no_contact');
  }
  const appointment = await deps.crm.bookAppointment({
    contactId: lead.contactId,
    calendarId: deps.calendarId,
    startTime,
    title: `Intro with ${lead.firstName} ${lead.lastName}`.trim(),
  });
  lead.appointmentId = appointment.id;
  lead.status = 'booked';
  await deps.leads.save(lead);
  await event(deps, lead, 'booked', 'ok', {
    appointmentId: appointment.id,
    startTime: appointment.startTime,
    request: { op: 'POST /calendars/events/appointments', contactId: lead.contactId, calendarId: deps.calendarId, startTime },
    response: { appointmentId: appointment.id, startTime: appointment.startTime, status: appointment.status },
  });

  if (lead.opportunityId) {
    const moved = await deps.crm.updateOpportunityStage(lead.opportunityId, deps.stageBooked);
    await event(deps, lead, 'stage_moved', 'ok', {
      opportunityId: moved.id,
      stageId: moved.stageId,
      request: { op: 'PUT /opportunities/{id}', opportunityId: lead.opportunityId, stageId: deps.stageBooked },
      response: { opportunityId: moved.id, stageId: moved.stageId },
    });
  }
  return lead;
}

export async function runMissedCall(deps: FlowDeps, leadId: string): Promise<StoredLead> {
  const lead = await deps.leads.get(leadId);
  const contact = await deps.crm.upsertContact({
    firstName: lead.firstName,
    lastName: lead.lastName,
    email: lead.email,
    phone: lead.phoneE164,
    tags: lead.tags,
    source: lead.attribution.source,
    customFields: lead.custom,
  });
  lead.contactId = contact.id;
  await deps.leads.save(lead);
  await event(deps, lead, 'upserted', 'ok', {
    contactId: contact.id,
    isNew: contact.isNew,
    request: { op: 'POST /contacts/upsert', firstName: lead.firstName, lastName: lead.lastName, email: lead.email, phone: lead.phoneE164, tags: lead.tags, customFields: lead.custom },
    response: { contactId: contact.id, isNew: contact.isNew },
  });
  const sms = await deps.crm.sendMessage({
    contactId: contact.id,
    type: 'SMS',
    body: missedCallSms(deps.businessName, lead.firstName),
  });
  lead.smsMessageId = sms.id;
  lead.status = 'text_back';
  await deps.leads.save(lead);
  await deps.leads.rememberIdentity(lead.email, lead.phoneE164, contact.id, lead.opportunityId);
  await event(deps, lead, 'text_back', 'ok', { messageId: sms.id });
  return lead;
}
