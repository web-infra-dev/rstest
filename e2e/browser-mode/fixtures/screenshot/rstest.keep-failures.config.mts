import { defineConfig } from '@rstest/core';

export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    screenshotFailures: { clean: false },
  },
  include: ['tests/**/*.test.ts'],
});
