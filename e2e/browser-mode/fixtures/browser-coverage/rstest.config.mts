import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS } from '../ports';

export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS['browser-coverage'],
  },
  include: ['tests/**/*.test.ts'],
  coverage: {
    enabled: true,
    include: ['src/**/*.ts'],
  },
});
