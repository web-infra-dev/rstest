import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS, BROWSER_TEST_TIMEOUT } from '../ports';

export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS.watch,
  },
  include: ['tests/**/*.test.ts'],
  testTimeout: BROWSER_TEST_TIMEOUT,
});
