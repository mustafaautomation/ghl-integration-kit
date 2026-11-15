import { z } from 'zod';

export const leadSourceIdSchema = z.enum(['meta', 'website_form', 'missed_call']);
export type LeadSourceId = z.infer<typeof leadSourceIdSchema>;

export const normalizedLeadSchema = z
  .object({
    source: leadSourceIdSchema,
    externalId: z.string().min(1).max(200),
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().max(80).default(''),
    email: z.string().trim().email().optional(),
    phoneE164: z
      .string()
      .regex(/^\+[1-9]\d{6,14}$/)
      .optional(),
    custom: z.record(z.string()).default({}),
    tags: z.array(z.string().min(1).max(40)).default([]),
    attribution: z.object({
      source: z.string().min(1).max(80),
      medium: z.string().max(80).optional(),
      campaign: z.string().max(120).optional(),
      adId: z.string().max(80).optional(),
    }),
    receivedAt: z.string().datetime(),
  })
  .refine((lead) => Boolean(lead.email || lead.phoneE164), {
    message: 'A lead needs an email or a phone number',
    path: ['email'],
  });

export type NormalizedLead = z.infer<typeof normalizedLeadSchema>;

export function parseNormalizedLead(input: unknown): NormalizedLead {
  return normalizedLeadSchema.parse(input);
}
