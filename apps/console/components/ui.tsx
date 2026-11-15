import type { ReactNode } from 'react';

export function Pill({ tone, children }: { tone: 'good' | 'warn' | 'bad' | 'info' | 'neutral'; children: ReactNode }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

export function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty">
      <span className="empty-mark" aria-hidden="true" />
      <h2>{title}</h2>
      <p>{body}</p>
    </div>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="skeleton" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <span key={index} />
      ))}
    </div>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-note" role="alert">
      <p>{message}</p>
      {onRetry ? (
        <button className="btn btn-ghost" type="button" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}
