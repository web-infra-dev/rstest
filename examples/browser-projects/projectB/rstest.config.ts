import { defineConfig } from '@rstest/core';

export default defineConfig({
  name: 'projectB',
  browser: {
    enabled: true,
    provider: 'playwright',
  },
  include: ['tests/**/*.test.ts'],
});
