import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS, BROWSER_TEST_TIMEOUT } from '../ports';

// Phase 5 step 5 gate: a failing `globalSetup` in a browser-only run must
// fail the run before any browser test executes, matching node semantics.
export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS['browser-global-setup-error'],
  },
  include: ['tests/**/*.test.ts'],
  testTimeout: BROWSER_TEST_TIMEOUT,
  globalSetup: ['./globalSetup.ts'],
});
