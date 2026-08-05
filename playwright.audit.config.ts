import { defineConfig } from '@playwright/test';

const VIEWPORTS: Array<[string, { width: number; height: number }]> = [
  ['mobile', { width: 375, height: 812 }],
  ['tablet', { width: 768, height: 1024 }],
  ['desktop', { width: 1440, height: 900 }],
];

const BROWSERS = ['chromium', 'firefox', 'webkit'];

export default defineConfig({
  testDir: './e2e',
  testMatch: 'ui-audit.spec.ts',
  timeout: 150_000,
  expect: { timeout: 25_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'e2e/test-results',
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
    actionTimeout: 20_000,
  },
  projects: BROWSERS.flatMap((browser) =>
    VIEWPORTS.map(([name, viewport]) => ({
      name: `${browser}-${name}`,
      use: { browserName: browser as 'chromium' | 'firefox' | 'webkit', viewport },
    }))
  ),
});