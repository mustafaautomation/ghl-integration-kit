import { expect } from 'vitest';
import type { CrmAdapter } from './types.js';

/** Shared behaviour every adapter has to satisfy. */
export async function assertCrmAdapterContract(adapter: CrmAdapter): Promise<void> {
  const first = await adapter.upsertContact({
    firstName: 'Jordan',
    lastName: 'Hale',
    email: 'jordan.hale@example.com',
    phone: '+12025550148',
    tags: ['speed-to-lead'],
    source: 'Meta Lead Ads',
    customFields: { interest: 'A first consult' },
  });
  expect(first.id).toBeTruthy();
  expect(first.isNew).toBe(true);
  expect(first.customFields.interest).toBe('A first consult');

  const second = await adapter.upsertContact({
    firstName: 'Jordan',
    lastName: 'Hale',
    email: 'jordan.hale@example.com',
    phone: '+12025550148',
    tags: ['speed-to-lead'],
    source: 'Meta Lead Ads',
    customFields: { interest: 'A first consult' },
  });
  expect(second.id).toBe(first.id);
  expect(second.isNew).toBe(false);

  const sms = await adapter.sendMessage({
    contactId: first.id,
    type: 'SMS',
    body: 'Hi Jordan, it is Northwind Studio.',
  });
  expect(sms.id).toBeTruthy();

  const email = await adapter.sendMessage({
    contactId: first.id,
    type: 'Email',
    subject: 'We got your request',
    body: 'Hi Jordan',
    html: '<p>Hi Jordan</p>',
  });
  expect(email.id).toBeTruthy();

  const opportunity = await adapter.createOpportunity({
    contactId: first.id,
    name: 'Jordan Hale — A first consult',
    pipelineId: 'pipe_new_leads',
    stageId: 'stage_new',
    status: 'open',
    monetaryValue: 0,
    source: 'Meta Lead Ads',
  });
  expect(opportunity.stageId).toBe('stage_new');

  const moved = await adapter.updateOpportunityStage(opportunity.id, 'stage_booked');
  expect(moved.id).toBe(opportunity.id);
  expect(moved.stageId).toBe('stage_booked');

  const start = Date.parse('2026-11-16T00:00:00.000Z');
  const slots = await adapter.getFreeSlots({
    calendarId: 'cal_intro',
    startMs: start,
    endMs: start + 3 * 86_400_000,
    timezone: 'America/New_York',
  });
  expect(slots.length).toBeGreaterThan(0);
  const slot = slots[0];
  if (!slot) throw new Error('expected a slot');

  const appointment = await adapter.bookAppointment({
    contactId: first.id,
    calendarId: 'cal_intro',
    startTime: slot.startTime,
    title: 'Intro with Jordan Hale',
  });
  expect(appointment.contactId).toBe(first.id);
  expect(appointment.startTime).toBe(slot.startTime);
}
