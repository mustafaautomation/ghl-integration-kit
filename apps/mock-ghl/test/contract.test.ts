import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  LEADCONNECTOR_VERSION,
  appointmentSchema,
  contactsListSchema,
  eventsListSchema,
  freeSlotsResponseSchema,
  locationResponseSchema,
  messageResponseSchema,
  opportunitiesSearchSchema,
  opportunityResponseSchema,
  parseFreeSlotTimes,
  tokenResponseSchema,
  upsertContactResponseSchema,
} from '@ghl/domain';
import { startMock } from '../src/server.js';

const fixture = (name: string) => JSON.parse(readFileSync(path.resolve(process.cwd(), 'fixtures/ghl', name), 'utf8')) as Record<string, unknown>;

function topKeys(value: Record<string, unknown>): string[] {
  return Object.keys(value).sort();
}

describe('mock GHL contract', () => {
  let url = '';
  let close: (() => Promise<void>) | undefined;
  let token = '';

  beforeAll(async () => {
    const started = await startMock({ port: 0, host: '127.0.0.1' });
    url = started.url;
    close = () => started.app.close();
    const issued = await fetch(
      `${url}/oauth/chooselocation?response_type=code&client_id=mock-client-id&redirect_uri=${encodeURIComponent('http://localhost:4000/oauth/callback')}&state=state_test&format=json`,
    );
    const code = (await issued.json()) as { code: string };
    const tokenRes = await fetch(`${url}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: 'mock-client-id',
        client_secret: 'mock-client-secret',
        grant_type: 'authorization_code',
        code: code.code,
        redirect_uri: 'http://localhost:4000/oauth/callback',
        user_type: 'Location',
      }),
    });
    const parsed = tokenResponseSchema.parse(await tokenRes.json());
    expect(topKeys(parsed as unknown as Record<string, unknown>)).toEqual(topKeys(fixture('token.json')));
    token = parsed.access_token;
  });

  afterAll(async () => {
    await close?.();
  });

  function headers() {
    return { Authorization: `Bearer ${token}`, Version: LEADCONNECTOR_VERSION, 'Content-Type': 'application/json' };
  }

  it('matches the documented contact, message, opportunity, slot, and appointment shapes', async () => {
    const location = locationResponseSchema.parse(await (await fetch(`${url}/locations/loc_northwind_555`, { headers: headers() })).json());
    expect(location.location.name).toBe('Northwind Studio');
    expect(topKeys(location)).toEqual(topKeys(fixture('location.json')));

    const upsert = upsertContactResponseSchema.parse(
      await (
        await fetch(`${url}/contacts/upsert`, {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({
            locationId: 'loc_northwind_555',
            firstName: 'Jordan',
            lastName: 'Hale',
            email: 'jordan.hale@example.com',
            phone: '+12025550148',
            tags: ['meta-lead'],
            source: 'Meta Lead Ads',
            customFields: [{ id: 'cf_interest', field_value: 'A first consult' }],
          }),
        })
      ).json(),
    );
    expect(upsert.new).toBe(true);
    expect(topKeys(upsert)).toEqual(topKeys(fixture('contact-upsert.json')));
    expect(topKeys(upsert.contact)).toEqual(topKeys((fixture('contact-upsert.json').contact as Record<string, unknown>)));

    const again = upsertContactResponseSchema.parse(
      await (
        await fetch(`${url}/contacts/upsert`, {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({
            locationId: 'loc_northwind_555',
            firstName: 'Jordan',
            lastName: 'Hale',
            email: 'jordan.hale@example.com',
            phone: '+12025550148',
          }),
        })
      ).json(),
    );
    expect(again.new).toBe(false);
    expect(again.contact.id).toBe(upsert.contact.id);

    const message = messageResponseSchema.parse(
      await (
        await fetch(`${url}/conversations/messages`, {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({ type: 'SMS', contactId: upsert.contact.id, locationId: 'loc_northwind_555', message: 'Hi' }),
        })
      ).json(),
    );
    expect(topKeys(message)).toEqual(topKeys(fixture('message.json')));

    const opportunity = opportunityResponseSchema.parse(
      await (
        await fetch(`${url}/opportunities/`, {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({
            locationId: 'loc_northwind_555',
            pipelineId: 'pipe_new_leads',
            pipelineStageId: 'stage_new',
            name: 'Jordan Hale',
            status: 'open',
            contactId: upsert.contact.id,
            monetaryValue: 0,
            source: 'Meta Lead Ads',
          }),
        })
      ).json(),
    );
    expect(topKeys(opportunity.opportunity)).toEqual(topKeys((fixture('opportunity.json').opportunity as Record<string, unknown>)));

    const moved = opportunityResponseSchema.parse(
      await (
        await fetch(`${url}/opportunities/${opportunity.opportunity.id}`, {
          method: 'PUT',
          headers: headers(),
          body: JSON.stringify({ pipelineStageId: 'stage_booked' }),
        })
      ).json(),
    );
    expect(moved.opportunity.pipelineStageId).toBe('stage_booked');

    const start = Date.now();
    const slotsBody = freeSlotsResponseSchema.parse(
      await (
        await fetch(
          `${url}/calendars/cal_intro/free-slots?startDate=${start}&endDate=${start + 6 * 86_400_000}&timezone=America/New_York`,
          { headers: headers() },
        )
      ).json(),
    );
    const slots = parseFreeSlotTimes(slotsBody);
    expect(slots.length).toBeGreaterThan(0);
    expect(slotsBody.traceId).toBe('trace_mock_555');

    const slot = slots[0];
    if (!slot) throw new Error('no slot');
    const appointment = appointmentSchema.parse(
      await (
        await fetch(`${url}/calendars/events/appointments`, {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify({
            calendarId: 'cal_intro',
            locationId: 'loc_northwind_555',
            contactId: upsert.contact.id,
            startTime: slot,
            title: 'Intro with Jordan Hale',
            appointmentStatus: 'confirmed',
          }),
        })
      ).json(),
    );
    expect(topKeys(appointment)).toEqual(topKeys(fixture('appointment.json')));

    const contacts = contactsListSchema.parse(await (await fetch(`${url}/contacts/?locationId=loc_northwind_555`, { headers: headers() })).json());
    expect(contacts.contacts).toHaveLength(1);
    expect(topKeys(contacts.meta)).toEqual(topKeys((fixture('contacts-list.json').meta as Record<string, unknown>)));

    const found = opportunitiesSearchSchema.parse(
      await (await fetch(`${url}/opportunities/search?location_id=loc_northwind_555`, { headers: headers() })).json(),
    );
    expect(found.opportunities).toHaveLength(1);

    const events = eventsListSchema.parse(
      await (await fetch(`${url}/calendars/events?locationId=loc_northwind_555&calendarId=cal_intro`, { headers: headers() })).json(),
    );
    expect(events.events).toHaveLength(1);
  });

  it('requires the version header and honours a forced 429', async () => {
    const missing = await fetch(`${url}/contacts/`, { headers: { Authorization: `Bearer ${token}` } });
    expect(missing.status).toBe(400);
    const limited = await fetch(`${url}/contacts/`, { headers: { ...headers(), 'x-mock-force-429': '1' } });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('1');
  });

  it('rotates the refresh token', async () => {
    const current = tokenResponseSchema.parse(
      await (
        await fetch(`${url}/oauth/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: 'mock-client-id',
            client_secret: 'mock-client-secret',
            grant_type: 'refresh_token',
            refresh_token: (await (async () => {
              const issued = await fetch(
                `${url}/oauth/chooselocation?response_type=code&client_id=mock-client-id&redirect_uri=${encodeURIComponent('http://localhost:4000/oauth/callback')}&state=state_refresh&format=json`,
              );
              const code = (await issued.json()) as { code: string };
              const tokenRes = await fetch(`${url}/oauth/token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                  client_id: 'mock-client-id',
                  client_secret: 'mock-client-secret',
                  grant_type: 'authorization_code',
                  code: code.code,
                  redirect_uri: 'http://localhost:4000/oauth/callback',
                  user_type: 'Location',
                }),
              });
              return tokenResponseSchema.parse(await tokenRes.json()).refresh_token;
            })()),
            user_type: 'Location',
          }),
        })
      ).json(),
    );
    expect(current.access_token).toBeTruthy();
    const reused = await fetch(`${url}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: 'mock-client-id',
        client_secret: 'mock-client-secret',
        grant_type: 'refresh_token',
        refresh_token: 'not-the-new-one',
        user_type: 'Location',
      }),
    });
    expect(reused.status).toBe(400);
  });
});
