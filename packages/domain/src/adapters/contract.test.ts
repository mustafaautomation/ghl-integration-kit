import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { GhlAdapter } from './ghl.js';
import { HubSpotStubAdapter } from './hubspot-stub.js';
import { RestCrmAdapter } from './rest.js';
import { assertCrmAdapterContract } from './contract.js';

async function listen(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function close(server: Server | undefined) {
  if (!server) return;
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

describe('adapter contract', () => {
  const servers: Server[] = [];
  afterEach(async () => {
    while (servers.length) await close(servers.pop());
  });

  it('runs against the HubSpot stub', async () => {
    const adapter = new HubSpotStubAdapter();
    expect(adapter.stub).toBe(true);
    expect(adapter.name).toBe('hubspot-stub');
    await assertCrmAdapterContract(adapter);
  });

  it('runs against the generic REST adapter', async () => {
    const contacts = new Map<string, Record<string, unknown>>();
    const opportunities = new Map<string, Record<string, unknown>>();
    const { server, baseUrl } = await listen(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const body = req.method === 'GET' ? {} : await readJson(req);
      const send = (status: number, payload: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      };
      if (req.method === 'POST' && url.pathname === '/contacts') {
        const email = String(body.email ?? '');
        const existing = [...contacts.values()].find((row) => row.email === email);
        const id = existing ? String(existing.id) : 'rest_contact_1';
        const record = { ...body, id, isNew: !existing };
        contacts.set(id, record);
        return send(200, record);
      }
      if (req.method === 'POST' && url.pathname === '/messages') {
        return send(200, { id: 'rest_msg_1', conversationId: 'rest_conv_1' });
      }
      if (req.method === 'POST' && url.pathname === '/opportunities') {
        const record = { ...body, id: 'rest_opp_1' };
        opportunities.set('rest_opp_1', record);
        return send(200, record);
      }
      if (req.method === 'PATCH' && url.pathname.startsWith('/opportunities/')) {
        const id = url.pathname.split('/').pop() ?? '';
        const current = opportunities.get(id) ?? { id };
        const next = { ...current, stageId: body.stageId };
        opportunities.set(id, next);
        return send(200, next);
      }
      if (req.method === 'GET' && url.pathname.includes('/free-slots')) {
        return send(200, { slots: [{ startTime: '2026-11-17T15:00:00.000Z' }] });
      }
      if (req.method === 'POST' && url.pathname === '/appointments') {
        return send(201, { ...body, id: 'rest_appt_1', status: 'confirmed' });
      }
      return send(404, { error: 'not_found' });
    });
    servers.push(server);
    await assertCrmAdapterContract(new RestCrmAdapter({ baseUrl, token: 'rest-token' }));
  });

  it('runs against the GHL adapter', async () => {
    const contacts = new Map<string, { id: string; email?: string }>();
    const opportunities = new Map<string, Record<string, unknown>>();
    const { server, baseUrl } = await listen(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      expect(req.headers.version).toBe('2021-07-28');
      expect(String(req.headers.authorization)).toBe('Bearer ghl-token');
      const body = req.method === 'GET' || req.method === 'HEAD' ? {} : await readJson(req);
      const send = (payload: unknown) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      };
      if (req.method === 'POST' && url.pathname === '/contacts/upsert') {
        const email = typeof body.email === 'string' ? body.email : undefined;
        const existing = [...contacts.values()].find((row) => row.email === email);
        const id = existing?.id ?? 'contact_555';
        contacts.set(id, { id, email });
        return send({
          new: !existing,
          contact: {
            id,
            locationId: 'loc_northwind_555',
            firstName: body.firstName,
            lastName: body.lastName,
            email,
            phone: body.phone,
            tags: body.tags,
            source: body.source,
            customFields: body.customFields,
          },
          traceId: 'trace_mock_555',
        });
      }
      if (req.method === 'POST' && url.pathname === '/conversations/messages') {
        return send({
          conversationId: 'conv_555',
          messageId: body.type === 'Email' ? 'msg_email_555' : 'msg_sms_555',
          emailMessageId: body.type === 'Email' ? 'msg_email_555' : null,
          msg: 'queued',
        });
      }
      if (req.method === 'POST' && url.pathname === '/opportunities/') {
        const record = {
          id: 'opp_555',
          name: body.name,
          monetaryValue: body.monetaryValue ?? 0,
          pipelineId: body.pipelineId,
          pipelineStageId: body.pipelineStageId,
          status: body.status,
          contactId: body.contactId,
          locationId: 'loc_northwind_555',
          source: body.source,
        };
        opportunities.set('opp_555', record);
        return send({ opportunity: record, traceId: 'trace_mock_555' });
      }
      if (req.method === 'PUT' && url.pathname.startsWith('/opportunities/')) {
        const id = url.pathname.split('/').filter(Boolean).pop() ?? '';
        const current = opportunities.get(id);
        const record = { ...(current ?? {}), id, pipelineStageId: body.pipelineStageId };
        opportunities.set(id, record);
        return send({ opportunity: record });
      }
      if (req.method === 'GET' && /\/calendars\/.+\/free-slots/.test(url.pathname)) {
        expect(url.searchParams.get('startDate')).toBeTruthy();
        expect(url.searchParams.get('timezone')).toBe('America/New_York');
        return send({
          '2026-11-17': { slots: ['2026-11-17T15:00:00-05:00'] },
          traceId: 'trace_mock_555',
        });
      }
      if (req.method === 'POST' && url.pathname === '/calendars/events/appointments') {
        return send({
          id: 'appt_555',
          calendarId: body.calendarId,
          locationId: 'loc_northwind_555',
          contactId: body.contactId,
          title: body.title,
          startTime: body.startTime,
          endTime: '2026-11-17T15:30:00-05:00',
          appointmentStatus: 'confirmed',
        });
      }
      res.writeHead(404);
      res.end();
    });
    servers.push(server);
    const adapter = new GhlAdapter({
      baseUrl,
      locationId: 'loc_northwind_555',
      getToken: async () => 'ghl-token',
      fieldIds: { interest: 'cf_interest' },
    });
    expect(adapter.stub).toBe(false);
    await assertCrmAdapterContract(adapter);
  });
});
