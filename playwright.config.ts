import { defineConfig, devices } from '@playwright/test';

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://ghl:ghl@127.0.0.1:5432/ghl';

export default defineConfig({
  testDir: 'apps/console/e2e',
  timeout: 60_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run start:mock',
      url: 'http://127.0.0.1:4100/_debug/counters',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { PORT: '4100', HOST: '127.0.0.1' },
    },
    {
      command: 'npm run start:api',
      url: 'http://127.0.0.1:4000/health',
      reuseExistingServer: !process.env.CI,
      timeout: 40_000,
      env: {
        GHL_MODE: 'mock',
        HOST: '127.0.0.1',
        PORT: '4000',
        DATABASE_URL: databaseUrl,
        QUEUE_DB_PATH: './data/e2e-queue.sqlite',
        LOG_LEVEL: 'info',
        CONSOLE_ORIGIN: 'http://127.0.0.1:3000',
        TOKEN_ENCRYPTION_KEY: 'ZGVtby1vbmx5LWtleS1ub3QtZm9yLWxpdmUtdXNlISE=',
        GHL_BASE_URL: 'http://127.0.0.1:4100',
        GHL_OAUTH_AUTHORIZE_URL: 'http://127.0.0.1:4100/oauth/chooselocation',
        GHL_CLIENT_ID: 'mock-client-id',
        GHL_CLIENT_SECRET: 'mock-client-secret',
        GHL_REDIRECT_URI: 'http://127.0.0.1:4000/oauth/callback',
        META_VERIFY_TOKEN: 'mock-meta-verify',
        META_APP_SECRET: 'mock-meta-secret',
        FORM_WEBHOOK_SECRET: 'mock-form-secret',
        QUEUE_POLL_MS: '40',
      },
    },
    {
      command: 'npm run start -w @ghl/console',
      url: 'http://127.0.0.1:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { NEXT_PUBLIC_API_BASE: 'http://127.0.0.1:4000' },
    },
  ],
});
