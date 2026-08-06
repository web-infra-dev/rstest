import { federation } from '@module-federation/rstest';
import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS, BROWSER_TEST_TIMEOUT } from '../ports';

// The test closes watch mode through the public shortcut workflow while stdin
// is piped by the e2e harness.
process.stdin.isTTY = true;
process.stdin.setRawMode = () => process.stdin;

export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: false,
    port: BROWSER_PORTS['basic-federation-watch'],
  },
  include: ['tests/**/*.test.ts'],
  testTimeout: BROWSER_TEST_TIMEOUT,
  plugins: [
    federation(
      {
        name: 'rstest_browser_watch',
      },
      { target: 'browser' },
    ),
  ],
});
