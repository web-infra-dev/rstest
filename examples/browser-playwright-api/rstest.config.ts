import { defineConfig } from '@rstest/core';

export default defineConfig({
  testTimeout: 10000,
  browser: {
    enabled: true,
    provider: 'playwright',
  },
  include: ['tests/**/*.test.ts'],
});
