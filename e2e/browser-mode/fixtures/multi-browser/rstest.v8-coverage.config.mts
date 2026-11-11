import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS, BROWSER_TEST_TIMEOUT, ciChromeEntry } from '../ports';

// v8 coverage with a multi-browser selection: validation must reject any
// selected non-chromium browser, and `--browser.instances chromium` must
// unblock the same config (the check runs after CLI filtering).
export default defineConfig({
  coverage: {
    enabled: true,
    provider: 'v8',
  },
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS['multi-browser'],
    instances: [
      {
        browserName: 'chromium',
        ...ciChromeEntry(),
      },
      { browserName: 'firefox' },
    ],
  },
  include: ['tests/basic.test.ts'],
  testTimeout: BROWSER_TEST_TIMEOUT,
});
