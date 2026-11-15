# Deploy

Local use stays `docker compose up --build`. The public host is one Cloudflare Worker on the free plan. It serves the operator console, the API, and the mock LeadConnector on one origin. Do not put secrets in this file or in git. `wrangler secret put` stores them on your account.

The first deploy uses `*.workers.dev`. Attach `ghl.quvantic.com` after that.

## What runs

| Piece | Where | Notes |
| --- | --- | --- |
| Console | Worker static assets | Built with `CONSOLE_EXPORT=1` and `NEXT_PUBLIC_API_BASE=/api`. |
| API | same Worker, `/api/*` | Hono calls `@ghl/domain`. It does not run Fastify. |
| Mock LeadConnector | Durable Object `MockGhl`, public path `/mock/*` | In-process calls use `https://mock.internal` and do not leave the Worker. |
| Store | D1 database `ghl` | Leads, tokens, inspections, job rows, rate-limit counters. |
| Jobs | Queue `ghl-jobs`, dead letter `ghl-jobs-dlq` | The D1 `jobs` table is what the console lists. The queue delivers the id and retries. |
| Live updates | `GET /api/stream` | Server-sent events. The Worker polls D1 and closes the stream; the browser reconnects. |
| Wipe | Cron `0 */6 * * *` | Deletes demo leads, inspections, and jobs, and clears the mock CRM. Keeps the install. |

`/api/health` is up. `/api/ready` checks D1. Migrations run before the first request if you apply them with wrangler, not inside the request.

## Free-plan limits

These are the Workers Free inclusions from the Cloudflare pricing and limits pages (checked November 2026). Daily counters reset at 00:00 UTC. Static asset requests are free and do not count toward the 100,000 request cap. `/api` and `/mock` do.

| Limit | Free plan |
| --- | --- |
| Worker requests | 100,000 / day |
| CPU time | 10 ms per HTTP request, cron, and queue invocation |
| Memory | 128 MB |
| Subrequests | 50 / request |
| Worker startup | 1 second |
| Cron triggers | 5 per account. This Worker uses one. Cron wall time 15 minutes, CPU still 10 ms. |
| Cron schedule here | every 6 hours |
| Queues | 10,000 operations / day, 24 hour retention. A delivered message is about 3 operations (write, read, delete). Each retry adds a read. |
| Queue wall time | 15 minutes. This consumer asks for at most 5 retries, then the dead-letter queue. |
| D1 | 5 million rows read / day, 100,000 rows written / day, 5 GB, 10 databases |
| Durable Objects | SQLite backend only. 100,000 requests / day, 13,000 GB-s duration / day. Storage rows match the D1 daily caps (5 million reads, 100,000 writes, 5 GB). |
| `waitUntil` | 30 seconds after the response |

The speed-to-lead path does its CRM calls as Durable Object fetches, not as public subrequests, so it stays under the 50-subrequest cap. The mock credentials in `wrangler.toml` are the same public demo values as `.env.example`. They are not a GoHighLevel account.

## Commands

From the repo root, logged in with `npx wrangler login`:

```bash
npx wrangler d1 create ghl
```

Copy the printed `database_id` into `wrangler.toml` under `[[d1_databases]]`. The file ships with a placeholder id of all zeros.

```bash
npx wrangler d1 migrations apply ghl --remote
npx wrangler queues create ghl-jobs
npx wrangler queues create ghl-jobs-dlq
npm run build:console:cf
npx wrangler deploy
```

`npm run build:workers` builds the console and runs `wrangler deploy --dry-run`. It does not publish.

The deploy prints a `*.workers.dev` URL. Open that, then send a test lead from the console. The API is `/api` on the same host. The mock consent screen, if you use Install, is `/mock/oauth/chooselocation`.

### Custom domain

After the workers.dev deploy works, uncomment the route block in `wrangler.toml`:

```toml
[[routes]]
pattern = "ghl.quvantic.com"
custom_domain = true
```

The zone for `quvantic.com` has to be on the same Cloudflare account. Then:

```bash
npx wrangler deploy
```

Cloudflare creates the DNS record. The console and the API stay on that one origin, so the browser calls `/api/...` and never a second host.

### Secrets

Mock mode deploys with the vars already in `wrangler.toml`. You do not need a secret for that.

For `GHL_MODE=live`, set real values. A secret replaces the var of the same name:

```bash
npx wrangler secret put TOKEN_ENCRYPTION_KEY
npx wrangler secret put GHL_CLIENT_ID
npx wrangler secret put GHL_CLIENT_SECRET
npx wrangler secret put META_APP_SECRET
npx wrangler secret put META_VERIFY_TOKEN
npx wrangler secret put FORM_WEBHOOK_SECRET
```

`TOKEN_ENCRYPTION_KEY` must be 32 bytes of base64 (`openssl rand -base64 32`). Live mode refuses the demo key. Also set `GHL_MODE=live` and, if you want a non-default consent screen, `GHL_OAUTH_AUTHORIZE_URL`. The redirect URI you register at HighLevel is `https://ghl.quvantic.com/api/oauth/callback`.

Changing a secret does not require a rebuild of the console. Changing `NEXT_PUBLIC_API_BASE` does, because Next bakes it into the static assets. The Workers build sets it to `/api`.

## Abuse and the wipe

`RATE_LIMIT_MAX` is 120 requests per minute per IP on `/api` and `/mock`. `/api/health` and `/api/ready` are not counted. Bodies over `BODY_LIMIT_BYTES` (256 KB) return 413.

The cron deletes lead, inspection, identity, slot, and job rows, and POSTs the mock's reset. It does not delete `installations`, so the mock location stays connected. A manual wipe is `POST /api/demo/reset` and only exists in mock mode.
