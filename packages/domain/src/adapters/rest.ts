import { GhlApiError } from '../queue/backoff.js';
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
 * A second adapter that speaks a small JSON API of our own, so the GHL shapes
 * stay inside `GhlAdapter`. Point it at any service that implements these paths.
 */
export class RestCrmAdapter implements CrmAdapter {
  readonly name = 'rest';
  readonly stub = false;

  constructor(
    private readonly opts: {
      baseUrl: string;
      token: string;
      fetchImpl?: typeof fetch;
    },
  ) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    const res = await fetchImpl(new URL(path.replace(/^\//, ''), this.opts.baseUrl.endsWith('/') ? this.opts.baseUrl : `${this.opts.baseUrl}/`), {
      method,
      headers: {
        Authorization: `Bearer ${this.opts.token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new GhlApiError(res.status, 'rest_crm_failed');
    return (await res.json()) as T;
  }

  upsertContact(input: ContactInput): Promise<ContactRecord> {
    return this.request('POST', '/contacts', input);
  }

  sendMessage(input: MessageInput): Promise<MessageRecord> {
    return this.request('POST', '/messages', input);
  }

  createOpportunity(input: OpportunityInput): Promise<OpportunityRecord> {
    return this.request('POST', '/opportunities', input);
  }

  updateOpportunityStage(id: string, stageId: string): Promise<OpportunityRecord> {
    return this.request('PATCH', `/opportunities/${id}`, { stageId });
  }

  async getFreeSlots(query: SlotQuery): Promise<Slot[]> {
    const result = await this.request<{ slots: Slot[] }>(
      'GET',
      `/calendars/${query.calendarId}/free-slots?startMs=${query.startMs}&endMs=${query.endMs}&timezone=${encodeURIComponent(query.timezone)}`,
    );
    return result.slots;
  }

  bookAppointment(input: AppointmentInput): Promise<AppointmentRecord> {
    return this.request('POST', '/appointments', input);
  }
}
