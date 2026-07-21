import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS } from '../ports';

// Browser-only run that sets node-only options: they are ignored but must each
// produce a one-time warning (anti-#1389 loud-validation pass).
export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS['browser-coverage'],
  },
  include: ['tests/sum.test.ts'],
  logHeapUsage: true,
  detectAsyncLeaks: true,
  pool: {
    type: 'threads',
  },
});
