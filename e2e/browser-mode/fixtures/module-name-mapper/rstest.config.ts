import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS } from '../ports';

export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS['module-name-mapper'],
  },
  include: ['tests/**/*.test.ts'],
  testTimeout: 30000,
  root: __dirname,
  resolve: {
    moduleNameMapper: {
      // Map module-a to module-b using exact match
      '^module-a$': '<rootDir>/src/moduleB.ts',
      // Map @utils/* to ./src/utils/* using capture groups
      '^@utils/(.*)$': '<rootDir>/src/utils/$1',
    },
  },
});
