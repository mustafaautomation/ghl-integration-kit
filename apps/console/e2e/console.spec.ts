import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
}

test.beforeAll(async () => {
  const res = await fetch('http://127.0.0.1:4000/demo/reset', { method: 'POST' });
  expect(res.ok).toBe(true);
});

test('desktop console', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'From a new lead to a booked call' })).toBeVisible();
  await axe(page);
  await page.screenshot({ path: 'docs/screenshots/overview-desktop.png', fullPage: true });

  await page.getByRole('button', { name: 'Send a test lead' }).click();
  await expect(page.getByRole('heading', { name: 'Jordan Hale' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Times offered' })).toBeVisible();
  await page.getByRole('button', { name: /AM|PM/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Appointment booked' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Moved to Booked' })).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/timeline-desktop.png', fullPage: true });
  await axe(page);

  await page.goto('/');
  await expect(page.getByRole('cell', { name: 'Jordan Hale' })).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/overview-filled-desktop.png', fullPage: true });

  await page.goto('/webhooks');
  await expect(page.getByRole('heading', { name: 'Webhooks' })).toBeVisible();
  await expect(page.getByText('Signature matched').first()).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/webhooks-desktop.png', fullPage: true });
  await axe(page);

  await page.goto('/calendar');
  await expect(page.getByText('Intro with Jordan Hale').first()).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/calendar-desktop.png', fullPage: true });
  await axe(page);

  await page.goto('/contacts');
  await expect(page.getByRole('cell', { name: 'Jordan Hale' })).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/contacts-desktop.png', fullPage: true });
  await axe(page);

  await page.goto('/opportunities');
  await expect(page.getByText('Booked').first()).toBeVisible();
  await axe(page);

  await page.goto('/queue');
  await expect(page.getByRole('heading', { name: 'Nothing is stuck' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'speed-to-lead' })).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/queue-desktop.png', fullPage: true });
  await axe(page);
});

test('mobile console', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'From a new lead to a booked call' })).toBeVisible();
  await axe(page);
  await page.screenshot({ path: 'docs/screenshots/overview-mobile.png', fullPage: true });

  await page.goto('/leads');
  await page.getByRole('link', { name: 'Jordan Hale' }).click();
  await expect(page.getByRole('heading', { name: 'Times offered' })).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/timeline-mobile.png', fullPage: true });
  await axe(page);

  await page.goto('/webhooks');
  await expect(page.getByText('Signature matched').first()).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/webhooks-mobile.png', fullPage: true });
  await axe(page);

  await page.goto('/calendar');
  await expect(page.getByText('Intro with Jordan Hale').first()).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/calendar-mobile.png', fullPage: true });
  await axe(page);
});
