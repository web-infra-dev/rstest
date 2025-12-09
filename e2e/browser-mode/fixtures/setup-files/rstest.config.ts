import { defineConfig } from '@rstest/core';

export default defineConfig({
  browser: {
    enabled: true,
    headless: true,
    port: 5190,
  },
  include: ['tests/**/*.test.ts'],
  setupFiles: ['./setup.ts'],
  testTimeout: 30000,
});
