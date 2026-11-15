import { expect, type Page } from '@playwright/test';

export class ConsolePage {
  constructor(readonly page: Page) {}

  async goto(path = '/') {
    await this.page.goto(path);
  }

  async axe() {
    const { default: AxeBuilder } = await import('@axe-core/playwright');
    const results = await new AxeBuilder({ page: this.page }).analyze();
    expect(results.violations).toEqual([]);
  }

  nav(name: string) {
    return this.page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name });
  }
}

export class OverviewPage extends ConsolePage {
  async sendLead() {
    await this.page.getByRole('button', { name: 'Send a test lead' }).click();
    await expect(this.page.getByRole('link', { name: 'Open the timeline' })).toBeVisible();
  }

  node(name: 'source' | 'check' | 'queue' | 'contact' | 'message' | 'book') {
    return this.page.locator(`[data-node="${name}"]`);
  }
}

export class TimelinePage extends ConsolePage {
  async open(name: string) {
    await this.page.getByRole('link', { name }).click();
    await expect(this.page.getByRole('heading', { level: 1, name })).toBeVisible();
  }

  step(name: string) {
    return this.page.getByRole('heading', { name });
  }
}

export class WebhooksPage extends ConsolePage {
  async openFirst() {
    await this.page.getByRole('button').filter({ hasText: /meta|ghl|website_form/ }).first().click();
  }
}

export class CalendarPage extends ConsolePage {
  bookButton() {
    return this.page.getByRole('button', { name: /Book / }).first();
  }
}

export class QueuePage extends ConsolePage {
  replay() {
    return this.page.getByRole('button', { name: 'Replay' });
  }
}
