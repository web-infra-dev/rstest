import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS } from '../ports';

export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS['browser-coverage-no-include'],
  },
  include: ['tests/**/*.test.ts'],
  coverage: {
    enabled: true,
    exclude: ['**/packages/browser/**/*'],
  },
});
