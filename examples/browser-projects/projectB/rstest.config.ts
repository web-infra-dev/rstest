import { defineConfig } from '@rstest/core';

export default defineConfig({
  name: 'projectB',
  browser: {
    enabled: true,
  },
  include: ['tests/**/*.test.ts'],
});
