'use client';

import { useEffect, useState } from 'react';
import { JsonBlock } from '../../components/Visuals';
import { Empty, ErrorNote, Pill, Skeleton } from '../../components/ui';
import { apiGet, type Inspection } from '../../lib/api';
import { formatWhen } from '../../lib/format';

function signatureHeaders(headers: Record<string, string>): Record<string, string> {
  const keep = ['content-type', 'x-ghl-signature', 'x-wh-signature', 'x-hub-signature-256', 'x-form-signature'];
  const picked: Record<string, string> = {};
  for (const key of keep) {
    const value = headers[key];
    if (value) picked[key] = value;
  }
  return picked;
}

function parsed(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

export default function WebhooksPage() {
  const [rows, setRows] = useState<Inspection[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const body = await apiGet<{ inspections: Inspection[] }>('/inspections');
      setRows(body.inspections);
      setSelected((current) => current ?? (body.inspections[0] ? String(body.inspections[0].id) : null));
      setError(null);
    } catch {
      setError('The API is not answering.');
    }
  }

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 4000);
    return () => clearInterval(timer);
  }, []);

  const current = rows?.find((row) => String(row.id) === selected) ?? null;

  return (
    <div className="rise">
      <div className="page-head">
        <div>
          <h1>Webhooks</h1>
          <p>Every delivery, with the signature result and whether we had already seen the event id.</p>
        </div>
      </div>
      {error ? <ErrorNote message={error} onRetry={() => void load()} /> : null}
      <div className="split">
        <div className="card" style={{ paddingTop: 4 }}>
          {rows === null ? (
            <Skeleton />
          ) : rows.length === 0 ? (
            <Empty title="No deliveries yet" body="Send a test lead, or post a webhook, and the raw payload will show up here." />
          ) : (
            rows?.map((row) => (
              <button
                key={row.id}
                type="button"
                className="list-btn"
                aria-current={String(row.id) === selected}
                onClick={() => setSelected(String(row.id))}
              >
                <strong>{row.source}</strong>
                <Pill tone={!row.signatureValid ? 'bad' : row.idempotentHit ? 'warn' : 'good'}>
                  {!row.signatureValid ? 'Rejected' : row.idempotentHit ? 'Duplicate' : 'Verified'}
                </Pill>
                <span>
                  {row.statusCode} · {row.reason ?? 'accepted'} · {formatWhen(row.createdAt)}
                </span>
              </button>
            ))
          )}
        </div>
        <div className="card" style={{ padding: 18 }}>
          {!current ? (
            <Empty title="Nothing selected" body="Pick a delivery to read the payload and the signature result." />
          ) : (
            <>
              <div className="row" style={{ marginBottom: 14 }}>
                <Pill tone={current.signatureValid ? 'good' : 'bad'}>{current.signatureValid ? 'Verified' : 'Rejected'}</Pill>
                {current.idempotentHit ? <Pill tone="warn">Duplicate</Pill> : <Pill tone="neutral">First delivery</Pill>}
                <Pill tone="info">{current.statusCode}</Pill>
              </div>
              <dl className="meta-grid">
                <dt>Source</dt><dd>{current.source}</dd>
                <dt>Event id</dt><dd className="mono">{current.eventId ?? '—'}</dd>
                <dt>Reason</dt><dd>{current.reason ?? 'accepted'}</dd>
              </dl>
              <h2>Payload</h2>
              <JsonBlock value={parsed(current.rawBody)} label="Webhook payload" />
              <h2 style={{ marginTop: 16 }}>Signature headers</h2>
              <pre className="pre" tabIndex={0} aria-label="Signature headers">{JSON.stringify(signatureHeaders(current.headers), null, 2)}</pre>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
