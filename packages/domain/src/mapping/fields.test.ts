import { describe, expect, it } from 'vitest';
import { applyFieldMap, fieldMapSchema, identityKeys, type FieldMap } from './fields.js';

const map: FieldMap = fieldMapSchema.parse({
  meta: {
    full_name: { to: 'name' },
    email: { to: 'email' },
    phone_number: { to: 'phone' },
    interested_in: { to: 'custom', key: 'interest' },
  },
  website_form: {
    first_name: { to: 'firstName' },
    last_name: { to: 'lastName' },
    email: { to: 'email' },
    phone: { to: 'phone' },
    service: { to: 'custom', key: 'interest' },
    page: { to: 'custom', key: 'landing_page' },
  },
});

describe('field mapping', () => {
  it('maps a Meta lead onto name, email, phone, and a custom field', () => {
    const mapped = applyFieldMap(
      'meta',
      {
        full_name: 'Jordan Hale',
        email: 'Jordan.Hale@Example.com',
        phone_number: '+1 555-013-4827',
        interested_in: 'A first consult',
        ignored: 'nope',
      },
      map,
    );
    expect(mapped.firstName).toBe('Jordan');
    expect(mapped.lastName).toBe('Hale');
    expect(mapped.email).toBe('jordan.hale@example.com');
    expect(mapped.phoneRaw).toBe('+1 555-013-4827');
    expect(mapped.custom).toEqual({ interest: 'A first consult' });
  });

  it('maps a website form without clobbering an explicit first name', () => {
    const mapped = applyFieldMap(
      'website_form',
      {
        first_name: 'Priya',
        last_name: 'Shah',
        email: 'priya.shah@example.com',
        phone: '5550142208',
        service: 'Brand workshop',
        page: 'https://example.com/start',
      },
      map,
    );
    expect(mapped).toMatchObject({
      firstName: 'Priya',
      lastName: 'Shah',
      email: 'priya.shah@example.com',
      custom: { interest: 'Brand workshop', landing_page: 'https://example.com/start' },
    });
  });

  it('builds dedupe keys from email and phone', () => {
    expect(identityKeys('Jordan.Hale@Example.com', '+15550134827')).toEqual([
      'email:jordan.hale@example.com',
      'phone:+15550134827',
    ]);
    expect(identityKeys(undefined, undefined)).toEqual([]);
  });
});
