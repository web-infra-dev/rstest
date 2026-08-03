import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS, BROWSER_TEST_TIMEOUT } from '../ports';

export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS.basic,
  },
  include: ['tests/**/*.test.ts'],
  exclude: [
    'tests/workerCleanupFailure.test.ts',
    'tests/workerCleanupAfterFatal.test.ts',
    'tests/workerCleanupTimeout.test.ts',
    'tests/workerSetupTimeout.test.ts',
    'tests/fileCleanupTimeout.test.ts',
    'tests/workerCleanupUnhandled.test.ts',
  ],
  testTimeout: BROWSER_TEST_TIMEOUT,
});
