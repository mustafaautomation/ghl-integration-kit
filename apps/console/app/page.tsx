'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { ErrorNote, Pill } from '../components/ui';
import { apiGet, type LeadSummary, type Stats } from '../lib/api';
import { sourceLabel, statusLabel, statusTone } from '../lib/format';

function Overview() {
  const router = useRouter();
  const installed = useSearchParams().get('installed') === '1';
  const [stats, setStats] = useState<Stats | null>(null);
  const [leads, setLeads] = useState<LeadSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [nextStats, nextLeads] = await Promise.all([apiGet<Stats>('/stats'), apiGet<{ leads: LeadSummary[] }>('/leads')]);
      setStats(nextStats);
      setLeads(nextLeads.leads);
      setError(null);
    } catch {
      setError('The API is not answering on port 4000. Start the stack, then try again.');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function sendLead() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:4000'}/demo/test-lead`, { method: 'POST' });
      const body = (await res.json()) as { leadId?: string };
      if (!res.ok || !body.leadId) throw new Error('send failed');
      router.push(`/leads/${body.leadId}`);
    } catch {
      setError('The test lead did not go through. Check that the API and the mock are running.');
      setBusy(false);
    }
  }

  return (
    <div className="rise">
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
      </div>
      {installed ? <p className="banner">The location is connected.</p> : null}
      {error ? <ErrorNote message={error} onRetry={() => void load()} /> : null}

      <section className="stats" aria-label="Today">
        <div className="stat"><span>Leads</span><strong>{stats?.leads ?? '—'}</strong></div>
        <div className="stat"><span>Messages</span><strong>{stats?.messages ?? '—'}</strong></div>
        <div className="stat"><span>Booked</span><strong>{stats?.booked ?? '—'}</strong></div>
        <div className="stat"><span>Dead letters</span><strong>{stats?.deadLetters ?? '—'}</strong></div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>How a lead moves</h2>
          <p>{stats ? `${stats.businessName} · ${stats.mode === 'mock' ? 'mock GHL' : 'live GHL'}` : 'Loading'}</p>
        </div>
        <div className="arch">
          <article className="card"><p className="step">1</p><h3>Sources</h3><p>Meta Lead Ads, a website form, or a missed-call webhook.</p></article>
          <article className="card"><p className="step">2</p><h3>This API</h3><p>Check the signature, drop replays, and queue the outbound calls.</p></article>
          <article className="card"><p className="step">3</p><h3>GHL</h3><p>Save the contact, send the first text, open the opportunity, offer times.</p></article>
          <article className="card"><p className="step">4</p><h3>This console</h3><p>The timeline updates live as each step finishes.</p></article>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Recent leads</h2>
          <Link href="/leads">All leads</Link>
        </div>
        <div className="card table-wrap" tabIndex={0} aria-label="Recent leads">
          {leads === null ? (
            <p className="muted" style={{ padding: 18 }}>Loading leads…</p>
          ) : leads.length === 0 ? (
            <div className="empty">
              <h2>No leads yet</h2>
              <p>Send a test lead and it will show up here with a live timeline.</p>
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

export default function Page() {
  return (
    <Suspense fallback={<p className="muted">Loading the console…</p>}>
      <Overview />
    </Suspense>
  );
}
