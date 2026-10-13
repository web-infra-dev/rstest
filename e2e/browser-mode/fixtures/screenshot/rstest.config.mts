import { defineConfig } from '@rstest/core';

export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
  },
  include: ['tests/**/*.test.ts'],
});
