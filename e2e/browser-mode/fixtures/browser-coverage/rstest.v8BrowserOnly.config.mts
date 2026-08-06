import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS } from '../ports';

// Browser-only run with the v8 coverage provider: unsupported, must hard-error.
export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS['browser-coverage-config-warnings'],
  },
  include: ['tests/sum.test.ts'],
  // No reportsDirectory: the run path hard-errors before coverage starts and
  // the list path never collects, so nothing is ever written.
  coverage: {
    enabled: true,
    provider: 'v8',
    include: ['src/**/*.ts'],
  },
});
