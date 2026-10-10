import { defineConfig } from '@playwright/test';

// Electron smoke tests: `npm run build` first, then `npm run test:e2e:electron`.
// On a headless Linux box run under xvfb-run.
export default defineConfig({
  testDir: 'tests/e2e/electron',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
});
