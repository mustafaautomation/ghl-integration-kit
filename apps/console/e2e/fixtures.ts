import { test as base } from '@playwright/test';
import { CalendarPage, ConsolePage, OverviewPage, QueuePage, TimelinePage, WebhooksPage } from './pages.js';

export const test = base.extend<{
  consolePage: ConsolePage;
  overview: OverviewPage;
  timeline: TimelinePage;
  webhooks: WebhooksPage;
  calendar: CalendarPage;
  queue: QueuePage;
}>({
  consolePage: async ({ page }, use) => use(new ConsolePage(page)),
  overview: async ({ page }, use) => use(new OverviewPage(page)),
  timeline: async ({ page }, use) => use(new TimelinePage(page)),
  webhooks: async ({ page }, use) => use(new WebhooksPage(page)),
  calendar: async ({ page }, use) => use(new CalendarPage(page)),
  queue: async ({ page }, use) => use(new QueuePage(page)),
});

export { expect } from '@playwright/test';
