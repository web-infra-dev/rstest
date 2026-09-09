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
    'tests/sum.test.ts',
    'tests/malformed-source-map.test.ts',
    'tests/cross-origin.fixture.ts',
    'tests/native-v8-scripts.fixture.ts',
  ],
  coverage: {
    enabled: true,
    provider: 'v8',
    include: ['src/**/*.ts'],
    reportsDirectory: './coverage-v8-browser',
  },
});
