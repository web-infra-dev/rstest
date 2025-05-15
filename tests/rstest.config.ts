import { defineConfig } from '@rstest/core';

export default defineConfig({
  setupFiles: ['../scripts/rstest.setup.ts'],
  testTimeout: process.env.CI ? 10_000 : 5_000,
  exclude: [
    '**/node_modules/**',
    '**/dist/**',
    '**/fixtures/**',
    '**/fixtures-test/**',
  ],
});
