import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS } from '../ports';

// A plain browser config, used to assert that nothing here draws an
// ignore-warning. It duplicates `rstest.config.mts` rather than reusing it
// because the two are launched from different test files, which run
// concurrently: they must not share a port, and `coverage.test.ts` clears and
// asserts the shared `coverage/` reports directory.
export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS['browser-coverage-default-warnings'],
  },
  include: ['tests/*.test.ts'],
  coverage: {
    enabled: true,
    include: ['src/**/*.ts'],
    reportsDirectory: './coverage-default-warnings',
  },
});
