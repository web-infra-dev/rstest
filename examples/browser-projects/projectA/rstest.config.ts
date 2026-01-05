import { defineConfig } from '@rstest/core';

export default defineConfig({
  name: 'projectA',
  browser: {
    enabled: true,
  },
  include: ['tests/**/*.test.ts'],
});
