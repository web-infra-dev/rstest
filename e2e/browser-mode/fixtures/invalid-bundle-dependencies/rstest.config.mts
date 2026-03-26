import { defineConfig } from '@rstest/core';

export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
  },
  output: {
    bundleDependencies: false,
  },
  include: ['tests/**/*.test.ts'],
});
