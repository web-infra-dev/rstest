import { defineConfig } from '@rstest/core';

export default defineConfig({
  browser: {
    enabled: true,
  },
  include: ['tests/**/*.test.ts'],
  testTimeout: 60000,
});
