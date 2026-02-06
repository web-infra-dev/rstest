import { defineConfig } from '@rstest/core';

export default defineConfig({
  name: 'project-b',
  include: ['tests/**/*.test.ts'],
  browser: {
    enabled: true,
    provider: 'playwright',
  },
});
