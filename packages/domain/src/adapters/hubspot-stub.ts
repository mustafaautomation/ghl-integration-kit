import { newId } from '../ids.js';
import type {
  AppointmentInput,
  AppointmentRecord,
  ContactInput,
  ContactRecord,
  CrmAdapter,
  MessageInput,
  MessageRecord,
  OpportunityInput,
  OpportunityRecord,
  Slot,
  SlotQuery,
} from './types.js';

/**
 * STUB. This class does not call HubSpot.
 * The methods match `CrmAdapter` and keep records in memory so the contract
 * tests have a third implementation. Replace each method with the HubSpot API
 * when you actually want that vendor. See the README, "Add your own adapter".
 */
export class HubSpotStubAdapter implements CrmAdapter {
  readonly name = 'hubspot-stub';
  readonly stub = true;

  private readonly contacts = new Map<string, ContactRecord>();
  private readonly byEmail = new Map<string, string>();
  private readonly opportunities = new Map<string, OpportunityRecord>();
  private readonly appointments: AppointmentRecord[] = [];

  async upsertContact(input: ContactInput): Promise<ContactRecord> {
    const existingId = input.email ? this.byEmail.get(input.email.toLowerCase()) : undefined;
    const id = existingId ?? newId('hs_stub');
    const record: ContactRecord = {
      id,
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      phone: input.phone,
      tags: input.tags,
      source: input.source,
      customFields: input.customFields,
      isNew: !existingId,
    };
    this.contacts.set(id, record);
    if (input.email) this.byEmail.set(input.email.toLowerCase(), id);
    return record;
  }

  async sendMessage(input: MessageInput): Promise<MessageRecord> {
    return { id: newId('hs_msg'), conversationId: `hs_thread_${input.contactId}` };
  }

  async createOpportunity(input: OpportunityInput): Promise<OpportunityRecord> {
    const record: OpportunityRecord = {
      id: newId('hs_deal'),
      name: input.name,
      contactId: input.contactId,
      pipelineId: input.pipelineId,
      stageId: input.stageId,
      status: input.status,
      monetaryValue: input.monetaryValue,
      source: input.source,
    };
    this.opportunities.set(record.id, record);
    return record;
  }

  async updateOpportunityStage(id: string, stageId: string): Promise<OpportunityRecord> {
    const current = this.opportunities.get(id);
    if (!current) throw new Error('hubspot_stub_missing_deal');
    const next = { ...current, stageId };
    this.opportunities.set(id, next);
    return next;
  }

  async getFreeSlots(query: SlotQuery): Promise<Slot[]> {
    const start = new Date(query.startMs);
    start.setUTCHours(15, 0, 0, 0);
    return [0, 1, 2].map((day) => {
      const slot = new Date(start.getTime() + day * 86_400_000);
      return { startTime: slot.toISOString() };
    });
  }

  async bookAppointment(input: AppointmentInput): Promise<AppointmentRecord> {
    const record: AppointmentRecord = {
      id: newId('hs_meet'),
      contactId: input.contactId,
      calendarId: input.calendarId,
      startTime: input.startTime,
      title: input.title,
      status: 'confirmed',
    };
    this.appointments.push(record);
    return record;
  }
}
