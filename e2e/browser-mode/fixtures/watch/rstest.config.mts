import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS, BROWSER_TEST_TIMEOUT } from '../ports';

export default defineConfig({
  tools: {
    rspack: {
      watchOptions: { ignored: (file) => file.endsWith('.ignored.ts') },
    },
  },
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS.watch,
  },
  include: ['tests/**/*.test.ts'],
  setupFiles: ['./setup.ts'],
  testTimeout: BROWSER_TEST_TIMEOUT,
});
