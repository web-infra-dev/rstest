import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS } from '../ports';

export default defineConfig({
  coverage: {
    enabled: true,
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
