import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS } from '../ports';

export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS['browser-coverage-v8'],
  },
  include: ['tests/mapped-error.fixture.ts'],
  coverage: {
    enabled: true,
    provider: 'v8',
    reportOnFailure: true,
    reporters: ['text', 'json'],
    reportsDirectory: './coverage-v8-mapped-error',
  },
});
