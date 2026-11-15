import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

export function toE164(input: string | undefined | null, defaultCountry: CountryCode = 'US'): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const parsed = parsePhoneNumberFromString(trimmed, defaultCountry);
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number;
}
