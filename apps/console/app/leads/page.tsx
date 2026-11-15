'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ErrorNote, Pill } from '../../components/ui';
import { apiGet, type LeadSummary } from '../../lib/api';
import { formatWhen, sourceLabel, statusLabel, statusTone } from '../../lib/format';

export default function LeadsPage() {
  const [leads, setLeads] = useState<LeadSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const body = await apiGet<{ leads: LeadSummary[] }>('/leads');
      setLeads(body.leads);
      setError(null);
    } catch {
      setError('The API is not answering on port 4000.');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="rise">
      <div className="page-head">
        <div>
          <h1>Leads</h1>
          <p>Everyone who came in through Meta, the site form, or a missed call.</p>
        </div>
      </div>
      {error ? <ErrorNote message={error} onRetry={() => void load()} /> : null}
      <div className="card table-wrap" tabIndex={0} aria-label="Leads">
        {leads === null ? (
          <p className="muted" style={{ padding: 18 }}>Loading leads…</p>
        ) : leads.length === 0 ? (
          <div className="empty">
            <h2>No leads yet</h2>
            <p>Send a test lead from the overview and it will land here.</p>
          </div>
        ) : (
          <table className="table">
            <caption className="sr-only">Leads</caption>
            <thead>
              <tr><th>Name</th><th>Source</th><th>Phone</th><th>Status</th><th>When</th></tr>
            </thead>
            <tbody>
              {(leads ?? []).map((lead) => (
                <tr key={lead.id}>
                  <td><Link href={`/leads/${lead.id}`}>{lead.name}</Link></td>
                  <td>{sourceLabel(lead.source)}</td>
                  <td className="mono">{lead.phoneE164 ?? '—'}</td>
                  <td><Pill tone={statusTone(lead.status)}>{statusLabel(lead.status)}</Pill></td>
                  <td>{formatWhen(lead.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
