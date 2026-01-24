import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/ui',
  timeout: 30_000,
  snapshotDir: 'tests/ui/__screenshots__',
  updateSnapshots: 'missing',
  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      scale: 'css',
    },
  },
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npm run dev -- --mode e2e --host 127.0.0.1 --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
  },
});
