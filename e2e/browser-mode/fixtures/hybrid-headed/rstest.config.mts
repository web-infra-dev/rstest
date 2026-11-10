import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS, BROWSER_TEST_TIMEOUT } from '../ports';

// One headed (project, browser) pair beside a headless row — a legal run
// shape (run-only: watch with a mixed headed/headless set is rejected).
// The helper clears CI for the spawned CLI but passes RSTEST_E2E_CHROME_CHANNEL
// through, so CI chrome runners install the chrome channel on the headed
// chromium entry without touching the firefox launch (see utils.ts).
export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS['hybrid-headed'],
    browsers: [
      {
        browserName: 'chromium',
        headless: false,
        viewport: { width: 800, height: 600 },
        ...(process.env.RSTEST_E2E_CHROME_CHANNEL
          ? { providerOptions: { launch: { channel: 'chrome' } } }
          : {}),
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
