import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { GhlApiError, RateLimitError } from '../queue/backoff.js';
import {
  appointmentSchema,
  contactsListSchema,
  eventsListSchema,
  freeSlotsResponseSchema,
  locationResponseSchema,
  messageResponseSchema,
  opportunitiesSearchSchema,
  opportunityResponseSchema,
  parseFreeSlotTimes,
  upsertContactResponseSchema,
} from './schemas.js';
import { tokenResponseSchema } from '../oauth/oauth.js';
import { ghlFetch } from './client.js';
import { LEADCONNECTOR_VERSION } from '../ids.js';

const fixtureDir = path.resolve(process.cwd(), 'fixtures/ghl');

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(fixtureDir, name), 'utf8')) as unknown;
}

describe('documented response fixtures', () => {
  it('parses the pinned LeadConnector shapes', () => {
    expect(tokenResponseSchema.parse(fixture('token.json')).token_type).toBe('Bearer');
    expect(upsertContactResponseSchema.parse(fixture('contact-upsert.json')).contact.id).toBeTruthy();
    expect(messageResponseSchema.parse(fixture('message.json')).messageId).toBeTruthy();
    expect(opportunityResponseSchema.parse(fixture('opportunity.json')).opportunity.pipelineId).toBe('pipe_new_leads');
    expect(freeSlotsResponseSchema.parse(fixture('free-slots.json'))).toBeTruthy();
    expect(parseFreeSlotTimes(fixture('free-slots.json')).length).toBeGreaterThan(0);
    expect(appointmentSchema.parse(fixture('appointment.json')).appointmentStatus).toBe('confirmed');
    expect(locationResponseSchema.parse(fixture('location.json')).location.name).toBe('Northwind Studio');
    expect(contactsListSchema.parse(fixture('contacts-list.json')).meta.total).toBe(1);
    expect(opportunitiesSearchSchema.parse(fixture('opportunities-search.json')).opportunities).toHaveLength(1);
    expect(eventsListSchema.parse(fixture('events.json')).events).toHaveLength(1);
  });
});

describe('ghlFetch', () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => server!.close((err) => (err ? reject(err) : resolve())));
      server = undefined;
    }
  });

  it('sends the Version header and the bearer token without logging them', async () => {
    let seenVersion = '';
    let seenAuth = '';
    server = createServer((req, res) => {
      seenVersion = String(req.headers.version);
      seenAuth = String(req.headers.authorization);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no port');
    const body = await ghlFetch(`http://127.0.0.1:${address.port}`, {
      method: 'GET',
      path: '/contacts/',
      token: 'token-should-stay-out-of-errors',
    });
    expect(body).toEqual({ ok: true });
    expect(seenVersion).toBe(LEADCONNECTOR_VERSION);
    expect(seenAuth).toBe('Bearer token-should-stay-out-of-errors');
  });

  it('turns a 429 into a RateLimitError that keeps Retry-After', async () => {
    server = createServer((_req, res) => {
      res.writeHead(429, { 'Retry-After': '3', 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Too Many Requests' }));
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no port');
    const now = new Date('2026-11-15T12:00:00.000Z');
    await expect(
      ghlFetch(
        `http://127.0.0.1:${address.port}`,
        { method: 'POST', path: '/contacts/upsert', token: 't', body: { a: 1 } },
        { now: () => now },
      ),
    ).rejects.toMatchObject({ name: 'RateLimitError', retryAfterMs: 3000 });
    await expect(
      ghlFetch(`http://127.0.0.1:${address.port}`, { method: 'GET', path: '/contacts/', token: 't' }),
    ).rejects.toBeInstanceOf(RateLimitError);
  });

  it('throws GhlApiError on other failures without the response body', async () => {
    server = createServer((_req, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Invalid JWT', token: 'leaked' }));
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no port');
    try {
      await ghlFetch(`http://127.0.0.1:${address.port}`, { method: 'GET', path: '/contacts/', token: 't' });
      throw new Error('should have failed');
    } catch (error) {
      expect(error).toBeInstanceOf(GhlApiError);
      expect((error as Error).message).not.toContain('leaked');
    }
  });
});
