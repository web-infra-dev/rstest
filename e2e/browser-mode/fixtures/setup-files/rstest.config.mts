import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS } from '../ports';

export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS['setup-files'],
  },
  include: ['tests/**/*.test.ts'],
  setupFiles: ['./setup.ts'],
  testTimeout: 30000,
});
