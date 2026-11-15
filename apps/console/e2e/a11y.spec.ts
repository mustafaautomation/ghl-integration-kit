import { test } from './fixtures.js';

const pages = ['/', '/leads', '/webhooks', '/contacts', '/opportunities', '/calendar', '/queue'];

test.describe('empty console', () => {
  test.beforeAll(async () => {
    const res = await fetch('http://127.0.0.1:4000/demo/reset', { method: 'POST' });
    if (!res.ok) throw new Error(`reset failed ${res.status}`);
  });

  for (const path of pages) {
    test(`axe desktop ${path}`, async ({ consolePage, page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.setViewportSize({ width: 1440, height: 900 });
      await consolePage.goto(path);
      await consolePage.axe();
    });

    test(`axe mobile ${path}`, async ({ consolePage, page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.setViewportSize({ width: 390, height: 844 });
      await consolePage.goto(path);
      await consolePage.axe();
    });
  }

  test('navigation reaches every section', async ({ consolePage, page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await consolePage.goto('/');
    for (const label of ['Leads', 'Webhooks', 'Contacts', 'Opportunities', 'Calendar', 'Queue', 'Overview']) {
      await consolePage.nav(label).click();
      await page.getByRole('heading', { level: 1 }).waitFor();
    }
    await page.getByRole('heading', { name: 'No leads yet' }).waitFor();
  });
});
