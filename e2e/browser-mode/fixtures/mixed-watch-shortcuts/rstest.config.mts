import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS, BROWSER_TEST_TIMEOUT } from '../ports';

// The shortcut tests drive stdin through a pipe; pretend it is a TTY so the
// CLI installs the watch shortcuts (same trick as e2e/watch/fixtures-shortcuts).
process.stdin.isTTY = true;
process.stdin.setRawMode = () => process.stdin;

// A mixed watch session: the node side owns stdin (single owner) and fans the
// shortcuts out to the browser session through the watch handles.
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
        port: BROWSER_PORTS['mixed-watch-shortcuts'],
      },
    },
  ],
});
