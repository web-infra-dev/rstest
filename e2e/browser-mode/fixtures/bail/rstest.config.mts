import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS, BROWSER_TEST_TIMEOUT } from '../ports';

export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS.bail,
  },
  include: ['tests/**/*.test.ts'],
  // Force a single headless worker so files run serially and the cross-file bail
  // gate is deterministic (parity with node's pool skip gate).
  pool: {
    maxWorkers: 1,
  },
  testTimeout: BROWSER_TEST_TIMEOUT,
});
