import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS, BROWSER_TEST_TIMEOUT } from '../ports';

export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS['multi-browser'],
    browsers: [
      {
        browserName: 'chromium',
        // Per-entry overrides: the viewports must differ so the in-page
        // attribution assertion can tell the two entries apart. The helper
        // clears CI in the spawned CLI but passes this variable through, so
        // CI chrome runners install the chrome channel on the one chromium
        // entry without touching the firefox launch (see utils.ts).
        viewport: { width: 800, height: 600 },
        ...(process.env.RSTEST_E2E_CHROME_CHANNEL
          ? { providerOptions: { launch: { channel: 'chrome' } } }
          : {}),
      },
      {
        browserName: 'firefox',
        viewport: { width: 900, height: 600 },
      },
    ],
  },
  // Pinned so the rules configs' basic.test.ts stays out of this run's count.
  include: ['tests/attribution.test.ts'],
  testTimeout: BROWSER_TEST_TIMEOUT,
});
