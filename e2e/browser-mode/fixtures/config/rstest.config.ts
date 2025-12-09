import { defineConfig } from '@rstest/core';

export default defineConfig({
  browser: {
    enabled: true,
    headless: true,
    port: 5184,
  },
  include: ['./*.test.ts'],
  testTimeout: 30000,
  globals: true,
});
