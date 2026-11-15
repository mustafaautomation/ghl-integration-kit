'use client';

import { useEffect, useState } from 'react';
import { Empty, ErrorNote, Pill } from '../../components/ui';
import { apiBase, apiGet, type QueueJob } from '../../lib/api';
import { formatWhen, statusLabel, statusTone } from '../../lib/format';

export default function QueuePage() {
  const [dead, setDead] = useState<QueueJob[]>([]);
  const [recent, setRecent] = useState<QueueJob[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const body = await apiGet<{ dead: QueueJob[]; recent: QueueJob[] }>('/queue');
      setDead(body.dead);
      setRecent(body.recent);
      setError(null);
    } catch {
      setError('The queue could not be loaded.');
    }
  }

  async function replay(id: string) {
    setError(null);
    const res = await fetch(`${apiBase}/queue/${id}/replay`, { method: 'POST' });
    if (!res.ok) {
      setError('That job could not be replayed.');
      return;
    }
    await load();
  }

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="rise">
      <div className="page-head">
        <div>
          <h1>Queue</h1>
          <p>Outbound calls retry with backoff. After the last attempt they sit in the dead-letter list.</p>
        </div>
        <button className="btn btn-ghost" type="button" onClick={() => void load()}>Refresh</button>
      </div>
      {error ? <ErrorNote message={error} onRetry={() => void load()} /> : null}
      <section className="section">
        <div className="section-head"><h2>Dead letter</h2></div>
        <div className="card table-wrap" tabIndex={0}>
          {dead.length === 0 ? (
            <Empty title="Nothing is stuck" body="A job lands here only after its retries are used up. Replay sends it back to the queue." />
          ) : (
            <JobTable jobs={dead} onReplay={(id) => void replay(id)} />
          )}
        </div>
      </section>
      <section className="section">
        <div className="section-head"><h2>Recent jobs</h2></div>
        <div className="card table-wrap" tabIndex={0}>
          {recent.length === 0 ? (
            <Empty title="No jobs yet" body="Sending a test lead queues the speed-to-lead job." />
          ) : (
            <JobTable jobs={recent} />
          )}
        </div>
      </section>
    </div>
  );
}

function JobTable({ jobs, onReplay }: { jobs: QueueJob[]; onReplay?: (id: string) => void }) {
  return (
    <table className="table">
      <caption className="sr-only">Jobs</caption>
      <thead>
        <tr><th>Job</th><th>Status</th><th>Attempts</th><th>Lead</th><th>Last error</th><th>Updated</th><th>Replay</th></tr>
      </thead>
      <tbody>
        {jobs.map((job) => (
          <tr key={job.id}>
            <td>{job.name}</td>
            <td><Pill tone={statusTone(job.status)}>{statusLabel(job.status)}</Pill></td>
            <td className="mono">{job.attempts}/{job.maxAttempts}</td>
            <td className="mono">{job.correlationId ?? '—'}</td>
            <td>{job.lastError ?? '—'}</td>
            <td>{formatWhen(new Date(job.updatedAt).toISOString())}</td>
            <td>
              {job.status === 'dead' && onReplay ? (
                <button className="btn btn-ghost" type="button" onClick={() => onReplay(job.id)}>Replay</button>
              ) : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
