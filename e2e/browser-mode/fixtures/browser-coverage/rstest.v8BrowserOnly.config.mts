import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS } from '../ports';

// Browser-only Chromium run with native V8 coverage.
export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS['browser-coverage-config-warnings'],
  },
  include: ['tests/sum.test.ts'],
  coverage: {
    enabled: true,
    provider: 'v8',
    include: ['src/**/*.ts'],
    reportsDirectory: './coverage-v8-browser-only',
  },
});
