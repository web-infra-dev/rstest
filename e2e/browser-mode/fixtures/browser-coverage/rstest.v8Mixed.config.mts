import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS } from '../ports';

// Mixed node + Chromium browser run with the V8 coverage provider.
export default defineConfig({
  coverage: {
    enabled: true,
    provider: 'v8',
    include: ['src/**/*.ts'],
    // Own reports directory: `coverage.test.ts` clears and asserts the shared
    // `coverage/` one, and it runs concurrently with this file.
    reportsDirectory: './coverage-v8-mixed',
  },
  projects: [
    {
      name: 'browser',
      browser: {
        enabled: true,
        provider: 'playwright',
        headless: true,
        port: BROWSER_PORTS['browser-coverage-config-warnings'],
      },
      include: ['tests/sum.test.ts'],
    },
    {
      name: 'node',
      include: ['tests/node/**/*.test.ts'],
    },
  ],
});
