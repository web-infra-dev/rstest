import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS, BROWSER_TEST_TIMEOUT } from '../ports';

// A genuine mixed run: one node project and one browser project in the same
// config, both matching real test files. Used to characterize the unified
// finalize path (single onTestRunEnd, merged exit code, and — the bug-2 fix —
// browser failures appearing in the failing-test summary block).
export default defineConfig({
  projects: [
    {
      name: 'node',
      include: ['node-tests/**/*.test.ts'],
    },
    {
      name: 'browser',
      include: ['browser-tests/**/*.test.ts'],
      testTimeout: BROWSER_TEST_TIMEOUT,
      browser: {
        enabled: true,
        provider: 'playwright',
        headless: true,
        port: BROWSER_PORTS.mixed,
      },
    },
  ],
});
