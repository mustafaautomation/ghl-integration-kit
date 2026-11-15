import { ghlFetch } from '../ghl/client.js';
import {
  appointmentSchema,
  messageResponseSchema,
  opportunityResponseSchema,
  parseFreeSlotTimes,
  upsertContactResponseSchema,
} from '../ghl/schemas.js';
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

function customList(fields: Record<string, string>, ids: Record<string, string>): Array<{ id: string; field_value: string }> {
  return Object.entries(fields).map(([key, value]) => ({ id: ids[key] ?? key, field_value: value }));
}

function customMap(fields: Array<{ id: string; field_value: string }> | undefined, ids: Record<string, string>): Record<string, string> {
  const reverse = new Map(Object.entries(ids).map(([key, id]) => [id, key]));
  const out: Record<string, string> = {};
  for (const field of fields ?? []) {
    out[reverse.get(field.id) ?? field.id] = field.field_value;
  }
  return out;
}

export class GhlAdapter implements CrmAdapter {
  readonly name = 'ghl';
  readonly stub = false;

  constructor(
    private readonly opts: {
      baseUrl: string;
      locationId: string;
      getLocationId?: () => Promise<string>;
      getToken: () => Promise<string>;
      fieldIds: Record<string, string>;
      fetchImpl?: typeof fetch;
    },
  ) {}

  private async locationId(): Promise<string> {
    if (this.opts.getLocationId) return this.opts.getLocationId();
    return this.opts.locationId;
  }

  private async call(method: string, path: string, body?: unknown, query?: Record<string, string | number | undefined>) {
    const token = await this.opts.getToken();
    return ghlFetch(
      this.opts.baseUrl,
      { method, path, token, body, query },
      { fetchImpl: this.opts.fetchImpl },
    );
  }

  async upsertContact(input: ContactInput): Promise<ContactRecord> {
    const json = await this.call('POST', '/contacts/upsert', {
      locationId: await this.locationId(),
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      phone: input.phone,
      tags: input.tags,
      source: input.source,
      customFields: customList(input.customFields, this.opts.fieldIds),
    });
    const parsed = upsertContactResponseSchema.parse(json);
    return {
      id: parsed.contact.id,
      firstName: parsed.contact.firstName ?? input.firstName,
      lastName: parsed.contact.lastName ?? input.lastName,
      email: parsed.contact.email,
      phone: parsed.contact.phone,
      tags: parsed.contact.tags ?? [],
      source: parsed.contact.source,
      customFields: customMap(parsed.contact.customFields, this.opts.fieldIds),
      isNew: parsed.new,
    };
  }

  async sendMessage(input: MessageInput): Promise<MessageRecord> {
    const json = await this.call('POST', '/conversations/messages', {
      type: input.type,
      contactId: input.contactId,
      locationId: await this.locationId(),
      message: input.type === 'SMS' ? input.body : undefined,
      subject: input.subject,
      html: input.type === 'Email' ? (input.html ?? input.body) : undefined,
    });
    const parsed = messageResponseSchema.parse(json);
    return { id: parsed.messageId, conversationId: parsed.conversationId };
  }

  async createOpportunity(input: OpportunityInput): Promise<OpportunityRecord> {
    const json = await this.call('POST', '/opportunities/', {
      locationId: await this.locationId(),
      pipelineId: input.pipelineId,
      pipelineStageId: input.stageId,
      name: input.name,
      status: input.status,
      contactId: input.contactId,
      monetaryValue: input.monetaryValue ?? 0,
      source: input.source,
    });
    return this.readOpportunity(json);
  }

  async updateOpportunityStage(id: string, stageId: string): Promise<OpportunityRecord> {
    const json = await this.call('PUT', `/opportunities/${id}`, {
      pipelineStageId: stageId,
    });
    return this.readOpportunity(json);
  }

  async getFreeSlots(query: SlotQuery): Promise<Slot[]> {
    const json = await this.call('GET', `/calendars/${query.calendarId}/free-slots`, undefined, {
      startDate: query.startMs,
      endDate: query.endMs,
      timezone: query.timezone,
    });
    return parseFreeSlotTimes(json).map((startTime) => ({ startTime }));
  }

  async bookAppointment(input: AppointmentInput): Promise<AppointmentRecord> {
    const json = await this.call('POST', '/calendars/events/appointments', {
      calendarId: input.calendarId,
      locationId: await this.locationId(),
      contactId: input.contactId,
      startTime: input.startTime,
      title: input.title,
      appointmentStatus: 'confirmed',
    });
    const parsed = appointmentSchema.parse(json);
    return {
      id: parsed.id,
      contactId: parsed.contactId,
      calendarId: parsed.calendarId,
      startTime: parsed.startTime,
      endTime: parsed.endTime,
      title: parsed.title,
      status: parsed.appointmentStatus,
    };
  }

  private readOpportunity(json: unknown): OpportunityRecord {
    const parsed = opportunityResponseSchema.parse(json);
    return {
      id: parsed.opportunity.id,
      name: parsed.opportunity.name,
      contactId: parsed.opportunity.contactId,
      pipelineId: parsed.opportunity.pipelineId,
      stageId: parsed.opportunity.pipelineStageId,
      status: parsed.opportunity.status,
      monetaryValue: parsed.opportunity.monetaryValue,
      source: parsed.opportunity.source,
    };
  }
}
