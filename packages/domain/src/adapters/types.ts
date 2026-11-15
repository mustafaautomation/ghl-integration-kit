export interface ContactInput {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  tags: string[];
  source: string;
  customFields: Record<string, string>;
}

export interface ContactRecord {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  tags: string[];
  source?: string;
  customFields: Record<string, string>;
  isNew: boolean;
}

export interface MessageInput {
  contactId: string;
  type: 'SMS' | 'Email';
  body: string;
  subject?: string;
  html?: string;
}

export interface MessageRecord {
  id: string;
  conversationId?: string;
}

export interface OpportunityInput {
  contactId: string;
  name: string;
  pipelineId: string;
  stageId: string;
  status: 'open' | 'won' | 'lost' | 'abandoned';
  monetaryValue?: number;
  source?: string;
}

export interface OpportunityRecord {
  id: string;
  name: string;
  contactId: string;
  pipelineId: string;
  stageId: string;
  status: string;
  monetaryValue?: number;
  source?: string;
}

export interface SlotQuery {
  calendarId: string;
  startMs: number;
  endMs: number;
  timezone: string;
}

export interface Slot {
  startTime: string;
}

export interface AppointmentInput {
  contactId: string;
  calendarId: string;
  startTime: string;
  title: string;
}

export interface AppointmentRecord {
  id: string;
  contactId: string;
  calendarId: string;
  startTime: string;
  endTime?: string;
  title: string;
  status: string;
}

/**
 * Outbound CRM calls used by the speed-to-lead flow.
 * Adapters hide vendor payload shapes behind these methods.
 */
export interface CrmAdapter {
  readonly name: string;
  /** True when the adapter does not call a real vendor. */
  readonly stub: boolean;
  upsertContact(input: ContactInput): Promise<ContactRecord>;
  sendMessage(input: MessageInput): Promise<MessageRecord>;
  createOpportunity(input: OpportunityInput): Promise<OpportunityRecord>;
  updateOpportunityStage(id: string, stageId: string): Promise<OpportunityRecord>;
  getFreeSlots(query: SlotQuery): Promise<Slot[]>;
  bookAppointment(input: AppointmentInput): Promise<AppointmentRecord>;
}
