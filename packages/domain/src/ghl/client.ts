import { LEADCONNECTOR_VERSION } from '../ids.js';
import { GhlApiError, parseRetryAfter, RateLimitError } from '../queue/backoff.js';

export interface GhlRequest {
  method: string;
  path: string;
  token: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
}

export async function ghlFetch(
  baseUrl: string,
  req: GhlRequest,
  opts?: { fetchImpl?: typeof fetch; version?: string; now?: () => Date },
): Promise<unknown> {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const url = new URL(req.path.replace(/^\//, ''), baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  for (const [key, value] of Object.entries(req.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${req.token}`,
    Version: opts?.version ?? LEADCONNECTOR_VERSION,
    Accept: 'application/json',
  };
  let body: string | undefined;
  if (req.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(req.body);
  }
  const res = await fetchImpl(url, { method: req.method, headers, body });
  if (res.status === 429) {
    throw new RateLimitError(parseRetryAfter(res.headers.get('retry-after'), opts?.now?.() ?? new Date()));
  }
  if (!res.ok) {
    // Check the status before parsing: gateways answer 5xx with HTML, and a
    // JSON SyntaxError would hide the status and quote the body in its message.
    throw new GhlApiError(res.status, `ghl_request_failed_${res.status}`);
  }
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new GhlApiError(res.status, 'ghl_invalid_json');
  }
}
