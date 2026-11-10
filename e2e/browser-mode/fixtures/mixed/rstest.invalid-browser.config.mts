import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS, BROWSER_TEST_TIMEOUT } from '../ports';

// Same shape as `rstest.config.mts` with an unknown browser name: the browser
// module's validation barrier must reject it before any test, node or browser,
// starts.
export default defineConfig({
  projects: [
    {
      name: 'node',
      include: ['node-tests/**/*.test.ts'],
    },
    {
      name: 'browser',
      include: ['browser-tests/**/*.test.ts'],
      testTimeout: BROWSER_TEST_TIMEOUT,
      browser: {
        enabled: true,
        provider: 'playwright',
        headless: true,
        port: BROWSER_PORTS.mixed,
        // @ts-expect-error deliberately outside the `BrowserName` union
        browsers: ['safari'],
      },
    },
  ],
});
