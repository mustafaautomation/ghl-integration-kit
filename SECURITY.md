# Security

This kit handles OAuth tokens and inbound webhooks. The notes below are the controls in the code and the things you still have to do yourself.

## Secrets

Secrets come from the environment. Nothing in git is a live credential. `.env.example` includes a demo `TOKEN_ENCRYPTION_KEY` so `docker compose up` works without a setup step. That key is public. Live mode (`GHL_MODE=live`) refuses to start when that demo key is set. Generate a real one with `openssl rand -base64 32` and keep it out of the repo, the image build args, and chat logs.

The files in `keys/test/` are a throwaway signing keypair for the mock. They are not HighLevel's keys.

## Tokens at rest

Location access tokens and refresh tokens are encrypted with AES-256-GCM before they are written to Postgres. The layout is a 12-byte IV, a 16-byte auth tag, then the ciphertext. A tampered row fails to decrypt. Refresh is single-flight per location, because a refresh response rotates the refresh token and a second in-flight refresh would strand the install.

## Logs

The pino logger redacts `access_token`, `refresh_token`, `client_secret`, `authorization`, and the webhook signature headers. The GHL client throws on HTTP errors without putting the response body in the error message, so a token echoed by a bad gateway does not land in the log line.

## OAuth

The install redirect sends a random `state`. The callback rejects a missing, expired, or already used state before it exchanges the code. The state lives for 10 minutes by default (`OAUTH_STATE_TTL_MS`).

## Webhooks

GHL signatures are checked against the raw body bytes. `X-GHL-Signature` (Ed25519) wins when it is present. `X-WH-Signature` (RSA-SHA256) is accepted only when the Ed25519 header is absent. A bad signature is stored as a rejected inspection and answered with `401`. A timestamp outside the window (default 5 minutes, 60 seconds of future skew) is also `401`, so a captured body cannot be replayed later. A repeated `webhookId` returns `200` with `duplicate: true` and does not run the flow again. Meta uses the verify-token handshake and `X-Hub-Signature-256`. Website forms use `X-Form-Signature` (HMAC-SHA256 over the raw body). Comparisons use `timingSafeEqual`.

Demo routes (`/demo/test-lead`, `/demo/reset`) exist only when `GHL_MODE=mock`.

The public Worker adds two controls the local process does not need. Each IP is limited to 120 requests a minute on `/api` and `/mock`, and request bodies over 256 KB are rejected. A cron trigger every six hours deletes demo leads, inspections, and queue rows, and clears the mock CRM. Install tokens are kept. The console still has no login.

## Input

Request bodies are capped at 256 KB. The Worker enforces that cap before the handler reads the body, and also rate-limits public `/api` and `/mock` calls per IP. Payloads are parsed with Zod before they become leads or CRM calls. Phone numbers are normalised to E.164 or dropped.

## What this does not do

The mock has no accounts. The operator console has no login; do not expose it on a public network. The webhook inspector stores headers and bodies so you can debug a delivery. That includes signature headers. Treat the database as sensitive. The generic REST adapter sends a bearer token from configuration; it does not add its own signing. The HubSpot class is a stub and does not talk to HubSpot.
