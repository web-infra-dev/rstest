import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS, BROWSER_TEST_TIMEOUT } from '../ports';

// A config-phase throw with no user plugin in the config: nothing runs, so the
// run must fail startup instead of reporting a cycle.
export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS.error,
  },
  include: ['tests/**/*.test.ts'],
  testTimeout: BROWSER_TEST_TIMEOUT,
  tools: {
    rspack() {
      throw new Error('Browser config failed intentionally');
    },
  },
});
