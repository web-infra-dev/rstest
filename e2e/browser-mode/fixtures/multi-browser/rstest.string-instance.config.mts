import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS, BROWSER_TEST_TIMEOUT } from '../ports';

// Deliberately invalid: instances must be objects, not bare browser names.
export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS['multi-browser'],
    // @ts-expect-error bare strings are not valid `BrowserInstanceConfig` items
    instances: ['chromium'],
  },
  include: ['tests/attribution.test.ts'],
  testTimeout: BROWSER_TEST_TIMEOUT,
});
