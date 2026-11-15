import type { LeadEvent } from '../lib/api';
import { pipelineState, type NodeId } from '../lib/pipeline';

const nodes: Array<{ id: NodeId; label: string; hint: string }> = [
  { id: 'source', label: 'Source', hint: 'Lead received' },
  { id: 'check', label: 'Check', hint: 'Signature' },
  { id: 'queue', label: 'Queue', hint: 'Outbound job' },
  { id: 'contact', label: 'Contact', hint: 'Upsert' },
  { id: 'message', label: 'Message', hint: 'First text' },
  { id: 'book', label: 'Book', hint: 'Calendar' },
];

export function Sparkline({ values, tone }: { values: number[]; tone: 'accent' | 'good' | 'warn' | 'bad' }) {
  const width = 88;
  const height = 28;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const points = values
    .map((value, index) => {
      const x = index * step;
      const y = height - 3 - (value / max) * (height - 6);
      return `${x},${y}`;
    })
    .join(' ');
  const last = values[values.length - 1] ?? 0;
  return (
    <svg className={`spark spark-${tone}`} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Last 8 hours, latest hour ${last}`}>
      <polyline points={points} fill="none" />
    </svg>
  );
}

export function Pipeline({ events }: { events: LeadEvent[] }) {
  const state = pipelineState(events.map((event) => event.type));
  return (
    <ol className="pipeline">
      {nodes.map((node) => (
        <li key={node.id} data-node={node.id} data-state={state[node.id]}>
          <span className="node-label">{node.label}</span>
          <span className="node-hint">
            {state[node.id] === 'done' ? 'Done' : state[node.id] === 'now' ? 'Now' : node.hint}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function JsonBlock({ value, label }: { value: unknown; label: string }) {
  return (
    <pre className="pre json" tabIndex={0} aria-label={label} dangerouslySetInnerHTML={{ __html: highlight(value) }} />
  );
}

function highlight(value: unknown): string {
  const json = JSON.stringify(value, null, 2) ?? 'null';
  const escaped = json.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return escaped.replace(/("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?/g, (match, str: string | undefined, colon: string | undefined) => {
    if (str && colon) return `<span class="tok-key">${str}</span>:`;
    if (str) return `<span class="tok-str">${str}</span>`;
    if (match === 'true' || match === 'false' || match === 'null') return `<span class="tok-bool">${match}</span>`;
    return `<span class="tok-num">${match}</span>`;
  });
}
