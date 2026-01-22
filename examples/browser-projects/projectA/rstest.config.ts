import { defineConfig } from '@rstest/core';

export default defineConfig({
  name: 'projectA',
  browser: {
    enabled: true,
    provider: 'playwright',
  },
  include: ['tests/**/*.test.ts'],
});
