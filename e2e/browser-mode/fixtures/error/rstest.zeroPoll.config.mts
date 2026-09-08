import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS } from '../ports';

export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS.error,
  },
  expect: {
    poll: {
      timeout: 0,
    },
  },
  include: ['tests/**/*.test.ts'],
  testTimeout: 0,
});
