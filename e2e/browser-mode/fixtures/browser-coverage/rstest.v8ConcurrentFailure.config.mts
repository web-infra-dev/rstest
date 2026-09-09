import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS } from '../ports';

export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS['browser-coverage-v8'],
  },
  include: [
    'tests/concurrent-fatal.fixture.ts',
    'tests/concurrent-sibling.fixture.ts',
  ],
  pool: {
    maxWorkers: 2,
  },
  coverage: {
    enabled: true,
    provider: 'v8',
    include: ['src/concurrent.ts'],
    reporters: ['json'],
    reportsDirectory: './coverage-v8-concurrent-failure',
    reportOnFailure: true,
  },
});
