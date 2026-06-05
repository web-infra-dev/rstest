import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS } from '../ports';

export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    browser: 'webkit',
    port: BROWSER_PORTS.webkit,
  },
  include: ['tests/**/*.test.ts'],
  testTimeout: 30000,
});
