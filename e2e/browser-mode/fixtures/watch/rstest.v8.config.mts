import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS, BROWSER_TEST_TIMEOUT } from '../ports';

export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS.watch,
  },
  coverage: {
    enabled: true,
    provider: 'v8',
    include: ['src/**/*.ts'],
    reporters: ['json'],
    reportsDirectory: './coverage-v8-watch',
    reportOnFailure: true,
  },
  include: ['tests/**/*.test.ts'],
  setupFiles: ['./setup.ts'],
  testTimeout: BROWSER_TEST_TIMEOUT,
});
