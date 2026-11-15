import { readFileSync } from 'node:fs';
import { signEd25519 } from '@ghl/domain';
import { expect, test } from './fixtures.js';

const edPrivate = readFileSync('keys/test/ed25519-private.pem', 'utf8');

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const res = await fetch('http://127.0.0.1:4000/demo/reset', { method: 'POST' });
  expect(res.ok).toBe(true);
});

test('a test lead reaches Booked through the live timeline', async ({ page, overview, timeline, calendar }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await overview.goto('/');
  await overview.sendLead();
  await expect(overview.node('contact')).toHaveAttribute('data-state', 'done', { timeout: 20_000 });
  await page.screenshot({ path: 'docs/screenshots/overview-mid-desktop.png', fullPage: true });
  await expect(overview.node('book')).toHaveAttribute('data-state', 'now', { timeout: 20_000 });

  await page.getByRole('link', { name: 'Open the timeline' }).click();
  await expect(timeline.step('Lead received')).toBeVisible();
  await expect(timeline.step('Times offered')).toBeVisible();
  await expect(page.getByText('Live')).toBeVisible();
  await page.getByText('Request and response').first().click();
  await expect(page.getByLabel('Lead received payload')).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/timeline-desktop.png', fullPage: true });

  await calendar.goto('/calendar');
  await expect(calendar.bookButton()).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/calendar-desktop.png', fullPage: true });
  await calendar.bookButton().click();
  await expect(page.getByText('Intro with Jordan Hale').first()).toBeVisible();

  await overview.goto('/');
  await expect(overview.node('book')).toHaveAttribute('data-state', 'done');
  await expect(page.getByRole('cell', { name: 'Jordan Hale' })).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/overview-filled-desktop.png', fullPage: true });
  await page.screenshot({ path: 'docs/screenshots/overview-desktop.png', fullPage: true });
});

test('a tampered signature is rejected and a duplicate is kept once', async ({ page, webhooks }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const raw = JSON.stringify({
    type: 'ContactCreate',
    webhookId: `wh_e2e_${Date.now()}`,
    timestamp: new Date().toISOString(),
    locationId: 'loc_northwind_555',
    data: {},
  });
  const bad = await page.request.post('http://127.0.0.1:4000/webhooks/ghl', {
    headers: { 'content-type': 'application/json', 'x-ghl-signature': 'aaaa' },
    data: raw,
  });
  expect(bad.status()).toBe(401);

  const goodRaw = JSON.stringify({
    type: 'ContactCreate',
    webhookId: `wh_e2e_dup_${Date.now()}`,
    timestamp: new Date().toISOString(),
    locationId: 'loc_northwind_555',
    data: {},
  });
  const signature = signEd25519(goodRaw, edPrivate);
  const first = await page.request.post('http://127.0.0.1:4000/webhooks/ghl', {
    headers: { 'content-type': 'application/json', 'x-ghl-signature': signature },
    data: goodRaw,
  });
  expect(first.status()).toBe(200);
  const second = await page.request.post('http://127.0.0.1:4000/webhooks/ghl', {
    headers: { 'content-type': 'application/json', 'x-ghl-signature': signature },
    data: goodRaw,
  });
  expect(second.status()).toBe(200);
  expect(await second.json()).toMatchObject({ duplicate: true });

  await webhooks.goto('/webhooks');
  await expect(page.getByText('Rejected').first()).toBeVisible();
  await expect(page.getByText('Duplicate').first()).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/webhooks-desktop.png', fullPage: true });
});

test('a failing outbound call retries, lands in the DLQ, and can be replayed', async ({ page, queue }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const res = await page.request.post('http://127.0.0.1:4000/demo/fail-outbound', {
    data: { failures: 3, retryAfterSeconds: 0, maxAttempts: 3 },
  });
  expect(res.ok()).toBeTruthy();
  const { jobId } = (await res.json()) as { jobId: string };
  await expect.poll(async () => {
    const body = (await (await page.request.get('http://127.0.0.1:4000/queue')).json()) as {
      recent: Array<{ id: string; attempts: number; status: string }>;
    };
    return body.recent.find((job) => job.id === jobId)?.attempts ?? 0;
  }).toBeGreaterThan(1);

  await queue.goto('/queue');
  await expect(page.getByRole('cell', { name: 'ghl-probe' }).first()).toBeVisible();
  await expect(queue.replay()).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: 'docs/screenshots/queue-desktop.png', fullPage: true });
  await queue.replay().click();
  await expect.poll(async () => {
    const body = (await (await page.request.get('http://127.0.0.1:4000/queue')).json()) as {
      recent: Array<{ id: string; status: string }>;
    };
    return body.recent.find((job) => job.id === jobId)?.status;
  }).toBe('completed');
});

test('mobile overview and timeline stay readable', async ({ page, overview, timeline }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await overview.goto('/');
  await expect(page.getByRole('heading', { name: 'From a new lead to a booked call' })).toBeVisible();
  await expect(overview.node('book')).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/overview-mobile.png', fullPage: true });
  await overview.axe();
  await timeline.goto('/leads');
  await timeline.open('Jordan Hale');
  await expect(timeline.step('Appointment booked')).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/timeline-mobile.png', fullPage: true });
  await timeline.axe();
  await timeline.goto('/webhooks');
  await page.screenshot({ path: 'docs/screenshots/webhooks-mobile.png', fullPage: true });
  await timeline.goto('/calendar');
  await page.screenshot({ path: 'docs/screenshots/calendar-mobile.png', fullPage: true });
});
