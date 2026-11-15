'use client';

import { useEffect, useState } from 'react';
import { Empty, ErrorNote, Pill } from '../../components/ui';
import { apiGet, type GhlOpportunity } from '../../lib/api';

function stageLabel(id: string): string {
  if (id === 'stage_booked') return 'Booked';
  if (id === 'stage_new') return 'New';
  return id;
}

export default function OpportunitiesPage() {
  const [rows, setRows] = useState<GhlOpportunity[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const body = await apiGet<{ opportunities: GhlOpportunity[] }>('/crm/opportunities');
      setRows(body.opportunities);
      setError(null);
    } catch {
      setError('Opportunities could not be loaded from the mock.');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="rise">
      <div className="page-head">
        <div>
          <h1>Opportunities</h1>
          <p>The new-leads pipeline. Booking a time moves the stage to Booked.</p>
        </div>
      </div>
      {error ? <ErrorNote message={error} onRetry={() => void load()} /> : null}
      <div className="card table-wrap" tabIndex={0} aria-label="Opportunities">
        {rows === null ? (
          <p className="muted" style={{ padding: 18 }}>Loading opportunities…</p>
        ) : rows.length === 0 ? (
          <Empty title="No opportunities yet" body="The speed-to-lead flow opens one after the first text goes out." />
        ) : (
          <table className="table">
            <caption className="sr-only">Opportunities</caption>
            <thead>
              <tr><th>Name</th><th>Stage</th><th>Status</th><th>Source</th></tr>
            </thead>
            <tbody>
              {(rows ?? []).map((row) => (
                <tr key={row.id}>
                  <td>{row.name}</td>
                  <td><Pill tone={row.pipelineStageId === 'stage_booked' ? 'good' : 'info'}>{stageLabel(row.pipelineStageId)}</Pill></td>
                  <td>{row.status}</td>
                  <td>{row.source ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
