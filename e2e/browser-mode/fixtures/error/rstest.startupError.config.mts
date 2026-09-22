import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS, BROWSER_TEST_TIMEOUT } from '../ports';

// With no user plugin, the browser config phase runs inside the first cycle.
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
