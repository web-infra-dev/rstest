import { defineConfig } from '@rstest/core';

export default defineConfig({
  include: ['test/**/*.test.ts'],
  coverage: {
    enabled: true,
    provider: 'v8',
    include: ['src/**/*.ts'],
    reporters: ['json'],
    reportsDirectory: 'coverage',
  },
});
