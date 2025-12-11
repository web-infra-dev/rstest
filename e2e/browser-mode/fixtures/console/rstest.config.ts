import { defineConfig } from '@rstest/core';

export default defineConfig({
  browser: {
    enabled: true,
    headless: true,
    port: 5192,
  },
  include: ['tests/**/*.test.ts'],
  testTimeout: 30000,
});
