import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS, BROWSER_TEST_TIMEOUT, ciChromeEntry } from '../ports';

// One headed entry and one headless entry in the same watch session: watch
// mode rejects the mixed shape at validation (run keeps it allowed).
export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS['multi-browser'],
    browsers: [
      {
        browserName: 'firefox',
        headless: false,
      },
      {
        browserName: 'chromium',
        ...ciChromeEntry(),
      },
    ],
  },
  include: ['tests/basic.test.ts'],
  testTimeout: BROWSER_TEST_TIMEOUT,
});
