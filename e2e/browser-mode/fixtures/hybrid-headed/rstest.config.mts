import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS, BROWSER_TEST_TIMEOUT, ciChromeEntry } from '../ports';

// One headed (project, browser) pair beside a headless row — a legal run
// shape (run-only: watch with a mixed headed/headless set is rejected).
export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS['hybrid-headed'],
    instances: [
      {
        browserName: 'chromium',
        headless: false,
        viewport: { width: 800, height: 600 },
        ...ciChromeEntry(),
      },
      {
        browserName: 'firefox',
        headless: true,
        viewport: { width: 900, height: 600 },
      },
    ],
  },
  include: ['tests/hybrid.test.ts'],
  testTimeout: BROWSER_TEST_TIMEOUT,
});
