import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS } from '../ports';

export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
    browser: 'webkit',
    headless: true,
    port: BROWSER_PORTS['browser-coverage-v8-webkit'],
  },
  include: ['tests/sum.test.ts'],
  coverage: {
    enabled: true,
    provider: 'v8',
  },
});
