import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS } from '../ports';

export default defineConfig({
  // Force the terminal `default` reporter (instead of the piped-output `md`
  // reporter) so single-file case expansion (`showAllCases`) is observable.
  reporters: ['default'],
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS['browser-verbose'],
  },
  include: ['tests/**/*.test.ts'],
});
