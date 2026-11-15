import { z } from 'zod';

export const fieldTargetSchema = z.union([
  z.object({
    to: z.enum(['firstName', 'lastName', 'name', 'email', 'phone', 'tag', 'source']),
  }),
  z.object({
    to: z.literal('custom'),
    key: z.string().min(1),
  }),
]);

export const fieldMapSchema = z.record(z.record(fieldTargetSchema));
export type FieldMap = z.infer<typeof fieldMapSchema>;
export type FieldTarget = z.infer<typeof fieldTargetSchema>;

export interface MappedFields {
  firstName: string;
  lastName: string;
  email?: string;
  phoneRaw?: string;
  tags: string[];
  source?: string;
  custom: Record<string, string>;
}

export function applyFieldMap(source: string, fields: Record<string, string>, map: FieldMap): MappedFields {
  const rules = map[source] ?? {};
  const out: MappedFields = { firstName: '', lastName: '', tags: [], custom: {} };
  for (const [field, raw] of Object.entries(fields)) {
    const value = raw.trim();
    if (!value) continue;
    const rule = rules[field];
    if (!rule) continue;
    if (rule.to === 'custom') {
      out.custom[rule.key] = value;
    } else if (rule.to === 'name') {
      const [first, ...rest] = value.split(/\s+/);
      if (!out.firstName) out.firstName = first ?? '';
      if (!out.lastName) out.lastName = rest.join(' ');
    } else if (rule.to === 'tag') {
      out.tags.push(value);
    } else if (rule.to === 'phone') {
      out.phoneRaw = value;
    } else if (rule.to === 'email') {
      out.email = value.toLowerCase();
    } else if (rule.to === 'firstName') {
      out.firstName = value;
    } else if (rule.to === 'lastName') {
      out.lastName = value;
    } else if (rule.to === 'source') {
      out.source = value;
    }
  }
  return out;
}

export function identityKeys(email?: string, phoneE164?: string): string[] {
  const keys: string[] = [];
  if (email) keys.push(`email:${email.trim().toLowerCase()}`);
  if (phoneE164) keys.push(`phone:${phoneE164}`);
  return keys;
}
