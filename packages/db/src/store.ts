import type { InstallationRecord, InstallationStore, LeadSourceId, NormalizedLead, StoredLead } from '@ghl/domain/edge';

export interface StoredEvent {
  id: number;
  leadId: string;
  type: string;
  status: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface InspectionRow {
  id: number;
  source: string;
  eventId: string | null;
  signatureValid: boolean;
  idempotentHit: boolean;
  statusCode: number;
  reason: string | null;
  rawBody: string;
  headers: Record<string, string>;
  createdAt: Date;
}

export interface LeadListRow {
  id: string;
  name: string;
  source: string;
  status: string;
  email: string | null;
  phoneE164: string | null;
  createdAt: string;
}

export interface LeadDetailRow {
  lead: StoredLead & { createdAt: string };
  events: StoredEvent[];
  slots: string[];
}

export interface OfferRow {
  leadId: string;
  startTime: string;
  name: string;
  status: string;
}

/**
 * Methods the Fastify repositories and the D1 adapter both provide.
 * TokenService only needs InstallationStore. The rest is the operator console and the lead flow.
 */
export interface OperatorStore extends InstallationStore {
  insertState(state: string, expiresAt: Date): Promise<void>;
  takeState(state: string): Promise<{ expiresAt: Date; usedAt: Date | null } | null>;
  markStateUsed(state: string, usedAt: Date): Promise<void>;
  tryInsertEvent(eventId: string, source: string): Promise<'inserted' | 'duplicate'>;
  inspect(input: {
    source: string;
    eventId: string | null;
    signatureValid: boolean;
    idempotentHit: boolean;
    statusCode: number;
    reason: string | null;
    rawBody: string;
    headers: Record<string, string>;
  }): Promise<void>;
  listInspections(limit?: number): Promise<InspectionRow[]>;
  createLead(lead: NormalizedLead, raw: unknown): Promise<StoredLead>;
  getLead(id: string): Promise<StoredLead>;
  saveLead(lead: StoredLead): Promise<void>;
  addEvent(
    leadId: string,
    event: { type: string; status: 'ok' | 'error' | 'skipped'; detail?: Record<string, unknown> },
  ): Promise<void>;
  findIdentity(email?: string, phoneE164?: string): Promise<{ contactId: string; openOpportunityId?: string } | null>;
  rememberIdentity(email: string | undefined, phoneE164: string | undefined, contactId: string, opportunityId?: string): Promise<void>;
  saveSlots(leadId: string, slots: string[]): Promise<void>;
  listLeads(limit?: number): Promise<LeadListRow[]>;
  detail(id: string): Promise<LeadDetailRow | null>;
  openOffers(): Promise<OfferRow[]>;
  activityStamps(): Promise<{ leads: Date[]; messages: Date[]; booked: Date[] }>;
  stats(): Promise<{ leads: number; messages: number; booked: number }>;
  eventsFor(leadId: string | undefined): Promise<StoredEvent[]>;
}

export type { InstallationRecord, LeadSourceId, NormalizedLead, StoredLead };
