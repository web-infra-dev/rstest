import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS } from '../ports';

export default defineConfig({
  browser: {
    enabled: true,
    headless: true,
    port: BROWSER_PORTS.config,
  },
  include: ['./*.test.ts'],
  testTimeout: 30000,
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
