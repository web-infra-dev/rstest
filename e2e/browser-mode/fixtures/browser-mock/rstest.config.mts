import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS, BROWSER_TEST_TIMEOUT } from '../ports';

// Exercises the whole rs.mock family inside browser test files (the browser
// client build registers the same mock transform pipeline as the node build).
export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS['browser-mock'],
  },
  include: ['tests/**/*.test.ts'],
  setupFiles: ['./rstest.setup.ts'],
  testTimeout: BROWSER_TEST_TIMEOUT,
});
