'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { JsonBlock } from '../../../components/Visuals';
import { ErrorNote, Pill, Skeleton } from '../../../components/ui';
import { apiBase, apiGet, type LeadDetail, type LeadEvent } from '../../../lib/api';
import { eventNote, eventTitle, formatSlot, formatWhen, sourceLabel, statusLabel, statusTone } from '../../../lib/format';

function stepTone(type: string): 'good' | 'warn' | 'bad' | 'info' | 'accent' {
  if (type === 'booked' || type === 'stage_moved') return 'good';
  if (type === 'deduped' || type === 'slots_offered') return 'warn';
  if (type === 'sms_sent' || type === 'email_sent' || type === 'text_back') return 'info';
  return 'accent';
}

function formatGap(ms: number): string {
  if (ms < 1000) return `${Math.max(0, ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export default function LeadPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [detail, setDetail] = useState<LeadDetail | null>(null);
  const [events, setEvents] = useState<LeadEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [booking, setBooking] = useState<string | null>(null);

  async function load() {
    try {
      const body = await apiGet<LeadDetail>(`/leads/${id}`);
      setDetail(body);
      setEvents(body.events);
      setError(null);
    } catch {
      setError('This lead could not be loaded.');
    }
  }

  useEffect(() => {
    void load();
    const stream = new EventSource(`${apiBase}/stream?leadId=${id}`);
    stream.addEventListener('open', () => setLive(true));
    stream.addEventListener('error', () => setLive(false));
    stream.addEventListener('lead', (message) => {
      const event = JSON.parse((message as MessageEvent).data) as LeadEvent;
      setEvents((current) => (current.some((item) => item.id === event.id) ? current : [...current, event]));
      if (event.type === 'slots_offered' || event.type === 'booked' || event.type === 'stage_moved' || event.type === 'deduped') {
        void load();
      }
    });
    return () => stream.close();
  }, [id]);

  async function book(startTime: string) {
    setBooking(startTime);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/leads/${id}/book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startTime }),
      });
      if (!res.ok) throw new Error('book failed');
      const body = (await res.json()) as LeadDetail;
      setDetail(body);
      setEvents(body.events);
    } catch {
      setError('That time did not book. Pick another slot.');
    } finally {
      setBooking(null);
    }
  }

  const lead = detail?.lead;
  const booked = lead?.status === 'booked';

  return (
    <div className="rise">
      <div className="page-head">
        <div>
          <p className="kicker">{lead ? sourceLabel(lead.source) : 'Lead'}</p>
          <h1>{lead ? `${lead.firstName} ${lead.lastName}` : 'Loading lead'}</h1>
        </div>
        <div className="row">
          {lead ? <Pill tone={statusTone(lead.status)}>{statusLabel(lead.status)}</Pill> : null}
          <span className="live"><i aria-hidden="true" />{live ? 'Live' : 'Reconnecting'}</span>
        </div>
      </div>
      {error ? <ErrorNote message={error} onRetry={() => void load()} /> : null}
      <div className="lead-grid">
      <div className="card" style={{ padding: 22 }}>
        {events.length === 0 ? <Skeleton rows={4} /> : null}
        <ol className="timeline">
          {events.map((event, index) => {
            const previous = events[index - 1];
            const gap = previous ? new Date(event.createdAt).getTime() - new Date(previous.createdAt).getTime() : 0;
            return (
              <li key={event.id} data-step={event.type}>
                <span className={`step-icon step-${stepTone(event.type)}`} aria-hidden="true" />
                <div className="tl-top">
                  <h2 className="tl-title">{eventTitle(event.type)}</h2>
                  <time dateTime={event.createdAt}>{formatWhen(event.createdAt)}</time>
                </div>
                <p>{eventNote(event)}{index > 0 ? ` · ${formatGap(gap)} after the previous step` : ''}</p>
                <details>
                  <summary>Request and response</summary>
                  <JsonBlock value={event.detail} label={`${eventTitle(event.type)} payload`} />
                </details>
              </li>
            );
          })}
        </ol>
        {!booked && (detail?.slots.length ?? 0) > 0 ? (
          <div>
            <h2 style={{ marginTop: 8 }}>Pick a time</h2>
            <div className="slots">
              {detail?.slots.map((slot) => (
                <button key={slot} className="btn btn-slot" type="button" onClick={() => void book(slot)} disabled={booking !== null}>
                  {booking === slot ? 'Booking…' : formatSlot(slot)}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <aside className="card summary" aria-label="Lead details">
        <h2>Details</h2>
        <dl>
          <dt>Email</dt>
          <dd>{lead?.email ?? '—'}</dd>
          <dt>Phone</dt>
          <dd className="mono">{lead?.phoneE164 ?? '—'}</dd>
          <dt>Interest</dt>
          <dd>{lead?.custom.interest ?? '—'}</dd>
          <dt>Source</dt>
          <dd>{lead ? sourceLabel(lead.source) : '—'}</dd>
          <dt>Lead id</dt>
          <dd className="mono">{id}</dd>
        </dl>
      </aside>
      </div>
    </div>
  );
}
