import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS } from '../ports';

export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS.viewport,
    viewport: {
      width: 390,
      height: 844,
    },
  },
  include: ['tests/**/*.test.ts'],
  testTimeout: 30000,
});
