import { z } from 'zod';

export const ghlContactSchema = z
  .object({
    id: z.string(),
    locationId: z.string(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    tags: z.array(z.string()).optional(),
    source: z.string().optional(),
    customFields: z.array(z.object({ id: z.string(), field_value: z.string() })).optional(),
    dateAdded: z.string().optional(),
    dateUpdated: z.string().optional(),
  })
  .passthrough();

export const upsertContactResponseSchema = z
  .object({
    new: z.boolean(),
    contact: ghlContactSchema,
    traceId: z.string().optional(),
  })
  .passthrough();

export const messageResponseSchema = z
  .object({
    conversationId: z.string(),
    messageId: z.string(),
    emailMessageId: z.string().nullable().optional(),
    messageIds: z.array(z.string()).optional(),
    msg: z.string().optional(),
    traceId: z.string().optional(),
  })
  .passthrough();

export const ghlOpportunitySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    monetaryValue: z.number().optional(),
    pipelineId: z.string(),
    pipelineStageId: z.string(),
    status: z.string(),
    contactId: z.string(),
    locationId: z.string(),
    source: z.string().optional(),
  })
  .passthrough();

export const opportunityResponseSchema = z
  .object({
    opportunity: ghlOpportunitySchema,
    traceId: z.string().optional(),
  })
  .passthrough();

export const freeSlotsResponseSchema = z.record(
  z.union([z.object({ slots: z.array(z.string()) }).passthrough(), z.string()]),
);

export const appointmentSchema = z
  .object({
    id: z.string(),
    calendarId: z.string(),
    locationId: z.string(),
    contactId: z.string(),
    title: z.string(),
    startTime: z.string(),
    endTime: z.string().optional(),
    appointmentStatus: z.string(),
    status: z.string().optional(),
    assignedUserId: z.string().optional(),
    dateAdded: z.string().optional(),
    dateUpdated: z.string().optional(),
  })
  .passthrough();

export const locationResponseSchema = z
  .object({
    location: z
      .object({
        id: z.string(),
        name: z.string(),
        companyId: z.string(),
        timezone: z.string().optional(),
      })
      .passthrough(),
    traceId: z.string().optional(),
  })
  .passthrough();

export const contactsListSchema = z
  .object({
    contacts: z.array(ghlContactSchema),
    meta: z
      .object({
        total: z.number(),
        currentPage: z.number(),
        nextPage: z.number().nullable(),
        prevPage: z.number().nullable(),
      })
      .passthrough(),
    traceId: z.string().optional(),
  })
  .passthrough();

export const opportunitiesSearchSchema = z
  .object({
    opportunities: z.array(ghlOpportunitySchema),
    meta: z.object({ total: z.number(), currentPage: z.number() }).passthrough(),
    traceId: z.string().optional(),
  })
  .passthrough();

export const eventsListSchema = z
  .object({
    events: z.array(appointmentSchema),
    traceId: z.string().optional(),
  })
  .passthrough();

export function parseFreeSlotTimes(body: unknown): string[] {
  const parsed = freeSlotsResponseSchema.parse(body);
  const slots: string[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (key === 'traceId' || typeof value === 'string') continue;
    slots.push(...value.slots);
  }
  return slots.sort();
}
