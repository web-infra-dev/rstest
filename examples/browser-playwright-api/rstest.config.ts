import { defineConfig } from '@rstest/core';

export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
  },
  include: ['tests/**/*.test.ts'],
});
