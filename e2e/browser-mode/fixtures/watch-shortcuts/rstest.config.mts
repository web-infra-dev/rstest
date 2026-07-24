import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS, BROWSER_TEST_TIMEOUT } from '../ports';

// The shortcut tests drive stdin through a pipe; pretend it is a TTY so the
// CLI installs the watch shortcuts (same trick as e2e/watch/fixtures-shortcuts).
process.stdin.isTTY = true;
process.stdin.setRawMode = () => process.stdin;

export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS['watch-shortcuts'],
  },
  include: ['tests/**/*.test.ts'],
  testTimeout: BROWSER_TEST_TIMEOUT,
});
