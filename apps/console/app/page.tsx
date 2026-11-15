'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Pipeline, Sparkline } from '../components/Visuals';
import { ErrorNote, Pill, Skeleton } from '../components/ui';
import { apiBase, apiGet, type LeadEvent, type LeadSummary, type Stats } from '../lib/api';
import { sourceLabel, statusLabel, statusTone } from '../lib/format';

function Overview() {
  const installed = useSearchParams().get('installed') === '1';
  const [stats, setStats] = useState<Stats | null>(null);
  const [leads, setLeads] = useState<LeadSummary[] | null>(null);
  const [events, setEvents] = useState<LeadEvent[]>([]);
  const [liveId, setLiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [nextStats, nextLeads] = await Promise.all([apiGet<Stats>('/stats'), apiGet<{ leads: LeadSummary[] }>('/leads')]);
      setStats(nextStats);
      setLeads(nextLeads.leads);
      setError(null);
      return nextLeads.leads;
    } catch {
      setError('The API is not answering. Start the stack, then try again.');
      return [];
    }
  }

  useEffect(() => {
    void (async () => {
      const rows = await load();
      const latest = rows[0];
      if (!latest) return;
      const detail = await apiGet<{ events: LeadEvent[] }>(`/leads/${latest.id}`);
      setEvents(detail.events);
      setLiveId(latest.id);
    })();
  }, []);

  useEffect(() => {
    if (!liveId) return;
    const stream = new EventSource(`${apiBase}/stream?leadId=${liveId}`);
    const onLead = (message: Event) => {
      const event = JSON.parse((message as MessageEvent).data) as LeadEvent;
      setEvents((current) => (current.some((item) => item.id === event.id) ? current : [...current, event]));
      void load();
    };
    stream.addEventListener('lead', onLead);
    return () => stream.close();
  }, [liveId]);

  async function sendLead() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/demo/test-lead`, { method: 'POST' });
      const body = (await res.json()) as { leadId?: string };
      if (!res.ok || !body.leadId) throw new Error('send failed');
      const detail = await apiGet<{ events: LeadEvent[] }>(`/leads/${body.leadId}`);
      setEvents(detail.events);
      setLiveId(body.leadId);
      await load();
    } catch {
      setError('The test lead did not go through. Check that the API and the mock are running.');
    } finally {
      setBusy(false);
    }
  }

  const series = stats?.series;

  return (
    <div className="rise">
      <div className="hero">
        <p className="kicker">Speed to lead</p>
        <h1>From a new lead to a booked call</h1>
        <p className="lede">
          Send a fake Meta lead for Jordan Hale. It takes the same path as a real one: signature check, contact upsert, a first text, an opportunity, and open times on the calendar.
        </p>
        <div className="actions row">
          <button className="btn btn-primary" type="button" onClick={() => void sendLead()} disabled={busy}>
            {busy ? 'Sending…' : 'Send a test lead'}
          </button>
          <Link className="btn btn-ghost" href="/calendar">
            Open the calendar
          </Link>
          {liveId ? <Link href={`/leads/${liveId}`}>Open the timeline</Link> : null}
        </div>
      </div>
      {installed ? <p className="banner">The location is connected.</p> : null}
      {error ? <ErrorNote message={error} onRetry={() => void load()} /> : null}

      <section className="stats" aria-label="Last 8 hours">
        <Stat label="Leads" value={stats?.leads} series={series?.leads} tone="accent" />
        <Stat label="Messages" value={stats?.messages} series={series?.messages} tone="warn" />
        <Stat label="Booked" value={stats?.booked} series={series?.booked} tone="good" />
        <Stat label="Dead letters" value={stats?.deadLetters} series={series?.deadLetters} tone="bad" />
      </section>

      <section className="section">
        <div className="section-head">
          <h2>How a lead moves</h2>
          <p>{stats ? `${stats.businessName} · ${stats.mode === 'mock' ? 'mock GHL' : 'live GHL'}` : 'Loading'}</p>
        </div>
        <div className="card pipeline-card">
          <Pipeline events={events} />
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Recent leads</h2>
          <Link href="/leads">All leads</Link>
        </div>
        <div className="card table-wrap" tabIndex={0} aria-label="Recent leads">
          {leads === null ? (
            <Skeleton rows={3} />
          ) : leads.length === 0 ? (
            <div className="empty">
              <span className="empty-mark" aria-hidden="true" />
              <h2>No leads yet</h2>
              <p>Send a test lead and the pipeline above will light up as each step finishes.</p>
            </div>
          ) : (
            <table className="table">
              <caption className="sr-only">Recent leads</caption>
              <thead>
                <tr><th>Name</th><th>Source</th><th>Status</th></tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <tr key={lead.id}>
                    <td><Link href={`/leads/${lead.id}`}>{lead.name}</Link></td>
                    <td>{sourceLabel(lead.source)}</td>
                    <td><Pill tone={statusTone(lead.status)}>{statusLabel(lead.status)}</Pill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, series, tone }: { label: string; value?: number; series?: number[]; tone: 'accent' | 'good' | 'warn' | 'bad' }) {
  const latest = series?.[series.length - 1] ?? 0;
  return (
    <div className={`stat stat-${tone}`}>
      <span>{label}</span>
      <strong>{value ?? '—'}</strong>
      {series ? <Sparkline values={series} tone={tone} /> : <span className="spark-gap" />}
      <small>{series ? `${latest} in the latest hour` : 'Last 8 hours'}</small>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<Skeleton rows={4} />}>
      <Overview />
    </Suspense>
  );
}
