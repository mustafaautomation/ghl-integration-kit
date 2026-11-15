'use client';

import { useEffect, useState } from 'react';
import { Empty, ErrorNote } from '../../components/ui';
import { apiGet, type GhlContact } from '../../lib/api';

export default function ContactsPage() {
  const [rows, setRows] = useState<GhlContact[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const body = await apiGet<{ contacts: GhlContact[] }>('/crm/contacts');
      setRows(body.contacts);
      setError(null);
    } catch {
      setError('Contacts could not be loaded from the mock.');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="rise">
      <div className="page-head">
        <div>
          <h1>Contacts</h1>
          <p>Read from the mock GoHighLevel location, not from a separate copy.</p>
        </div>
      </div>
      {error ? <ErrorNote message={error} onRetry={() => void load()} /> : null}
      <div className="card table-wrap" tabIndex={0} aria-label="Contacts">
        {rows === null ? (
          <p className="muted" style={{ padding: 18 }}>Loading contacts…</p>
        ) : rows.length === 0 ? (
          <Empty title="No contacts yet" body="A test lead creates Jordan Hale here after the upsert step." />
        ) : (
          <table className="table">
            <caption className="sr-only">Contacts in the mock location</caption>
            <thead>
              <tr><th>Name</th><th>Email</th><th>Phone</th><th>Source</th><th>Tags</th></tr>
            </thead>
            <tbody>
              {(rows ?? []).map((row) => (
                <tr key={row.id}>
                  <td>{`${row.firstName ?? ''} ${row.lastName ?? ''}`.trim() || 'Unnamed'}</td>
                  <td>{row.email ?? '—'}</td>
                  <td className="mono">{row.phone ?? '—'}</td>
                  <td>{row.source ?? '—'}</td>
                  <td>{(row.tags ?? []).join(', ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
