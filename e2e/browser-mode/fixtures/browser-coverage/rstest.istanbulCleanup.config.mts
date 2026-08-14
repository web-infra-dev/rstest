import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS } from '../ports';

export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS['browser-coverage-v8'],
  },
  include: ['tests/cleanup-a.test.ts', 'tests/cleanup-b.test.ts'],
  isolate: false,
  coverage: {
    enabled: true,
    provider: 'istanbul',
    include: ['src/**/*.ts'],
    reportsDirectory: './coverage-istanbul-cleanup',
  },
});
