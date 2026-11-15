export const apiBase = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:4000';

export interface LeadSummary {
  id: string;
  name: string;
  source: string;
  status: string;
  email: string | null;
  phoneE164: string | null;
  createdAt: string;
}

export interface LeadEvent {
  id: number;
  leadId: string;
  type: string;
  status: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface LeadDetail {
  lead: {
    id: string;
    firstName: string;
    lastName: string;
    email?: string;
    phoneE164?: string;
    source: string;
    status: string;
    custom: Record<string, string>;
    attribution: { source: string; medium?: string; campaign?: string };
    createdAt: string;
  };
  events: LeadEvent[];
  slots: string[];
}

export interface Inspection {
  id: number;
  source: string;
  eventId: string | null;
  signatureValid: boolean;
  idempotentHit: boolean;
  statusCode: number;
  reason: string | null;
  rawBody: string;
  headers: Record<string, string>;
  createdAt: string;
}

export interface Stats {
  leads: number;
  messages: number;
  booked: number;
  deadLetters: number;
  mode: string;
  businessName: string;
  locationId: string;
}

export interface GhlContact {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  tags?: string[];
  source?: string;
}

export interface GhlOpportunity {
  id: string;
  name: string;
  pipelineStageId: string;
  status: string;
  source?: string;
  monetaryValue?: number;
  contactId: string;
}

export interface GhlAppointment {
  id: string;
  title: string;
  startTime: string;
  endTime?: string;
  appointmentStatus: string;
  contactId: string;
}

export interface QueueJob {
  id: string;
  name: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  runAt: number;
  lastError: string | null;
  correlationId: string | null;
  updatedAt: number;
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${apiBase}${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as T;
}
