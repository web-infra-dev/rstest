import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS } from '../ports';

// Mixed node + browser run with the v8 coverage provider: warns (browser files
// get no coverage) but does not error; the node project still uses v8.
export default defineConfig({
  coverage: {
    enabled: true,
    provider: 'v8',
    include: ['src/**/*.ts'],
  },
  projects: [
    {
      name: 'browser',
      browser: {
        enabled: true,
        provider: 'playwright',
        headless: true,
        port: BROWSER_PORTS['browser-coverage-multiproject'],
      },
      include: ['tests/sum.test.ts'],
    },
    {
      name: 'node',
      include: ['tests/node/**/*.test.ts'],
    },
  ],
});
