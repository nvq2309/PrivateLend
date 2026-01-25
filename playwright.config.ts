import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/ui',
  timeout: 120_000,
  retries: 1,
  snapshotDir: 'tests/ui/__screenshots__',
  updateSnapshots: 'missing',
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      animations: 'disabled',
      scale: 'css',
    },
  },
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    viewport: { width: 1280, height: 1111 },
    deviceScaleFactor: 1,
    actionTimeout: 15_000,
  },
  workers: process.env.CI ? 1 : undefined,
  webServer: {
    command: 'npm run dev -- --mode e2e --host 127.0.0.1 --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
