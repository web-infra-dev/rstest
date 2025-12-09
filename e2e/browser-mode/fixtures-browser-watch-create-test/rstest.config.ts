import { defineConfig } from '@rstest/core';

export default defineConfig({
  browser: {
    enabled: true,
    headless: true,
  },
  include: ['tests/**/*.test.ts'],
  testTimeout: 30000,
});
