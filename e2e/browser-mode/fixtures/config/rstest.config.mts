import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS, BROWSER_TEST_TIMEOUT } from '../ports';

export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS.config,
  },
  include: ['./*.test.ts', './git/*.test.ts'],
  testTimeout: BROWSER_TEST_TIMEOUT,
  globals: true,
  source: {
    define: {
      __TEST_DEFINE__: JSON.stringify('define-value'),
    },
  },
  resolve: {
    alias: {
      '@test-alias': './aliasedModule.ts',
    },
  },
});
