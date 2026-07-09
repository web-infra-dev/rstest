import { defineConfig } from '@rstest/core';
import { BROWSER_TEST_TIMEOUT } from '../ports';
import { BROWSER_PORTS } from './ports';

export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS.snapshot,
  },
  include: ['tests/**/*.test.ts'],
  testTimeout: BROWSER_TEST_TIMEOUT,
});
