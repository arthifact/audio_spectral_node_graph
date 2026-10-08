import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  use: {
    channel: process.env.PLAYWRIGHT_CHANNEL,
    baseURL: 'http://127.0.0.1:8000',
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build && node scripts/serve.js --built',
    url: 'http://127.0.0.1:8000',
    reuseExistingServer: !process.env.CI,
  },
});
