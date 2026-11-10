import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS, BROWSER_TEST_TIMEOUT } from '../ports';

// Runs the deprecated single-browser field: `browser.browser` must keep
// working with a once-per-run deprecation warning.
export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS['multi-browser'],
    browser: 'firefox',
  },
  include: ['tests/basic.test.ts'],
  testTimeout: BROWSER_TEST_TIMEOUT,
});
