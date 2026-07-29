import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS } from '../ports';

// Browser-only run with the v8 coverage provider: unsupported, must hard-error.
export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS['browser-coverage-v8-browser-only'],
  },
  include: ['tests/sum.test.ts'],
  coverage: {
    enabled: true,
    provider: 'v8',
    include: ['src/**/*.ts'],
    // Own reports directory: `coverage.test.ts` clears and asserts the shared
    // `coverage/` one, and it runs concurrently with this file.
    reportsDirectory: './coverage-v8-browser-only',
  },
});
