import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS, BROWSER_TEST_TIMEOUT } from '../ports';

// Phase 5 step 5 gate: a browser-only run must execute `globalSetup` on the
// host and propagate its `process.env` changes into the browser runtime env
// store, with explicit `test.env` config still taking precedence.
export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS['browser-global-setup'],
  },
  include: ['tests/**/*.test.ts'],
  testTimeout: BROWSER_TEST_TIMEOUT,
  globalSetup: ['./globalSetup.ts'],
  env: {
    RSTEST_E2E_GS_OVERRIDE: 'from-config',
  },
});
