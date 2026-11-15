export interface IdempotencyStore {
  tryInsert(eventId: string, source: string): Promise<'inserted' | 'duplicate'>;
}

export class MemoryIdempotencyStore implements IdempotencyStore {
  private readonly seen = new Set<string>();

  async tryInsert(eventId: string, _source: string): Promise<'inserted' | 'duplicate'> {
    if (this.seen.has(eventId)) return 'duplicate';
    this.seen.add(eventId);
    return 'inserted';
  }
}

export interface InspectionRecord {
  source: string;
  eventId: string | null;
  signatureValid: boolean;
  idempotentHit: boolean;
  statusCode: number;
  reason: string | null;
  rawBody: string;
  headers: Record<string, string>;
}

export function inspectionForRejection(input: {
  source: string;
  rawBody: string;
  headers: Record<string, string>;
  reason: string;
  statusCode: number;
  eventId?: string | null;
}): InspectionRecord {
  return {
    source: input.source,
    eventId: input.eventId ?? null,
    signatureValid: false,
    idempotentHit: false,
    statusCode: input.statusCode,
    reason: input.reason,
    rawBody: input.rawBody,
    headers: input.headers,
  };
}
