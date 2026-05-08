import { defineConfig } from '@rstest/core';

export default defineConfig({
  include: ['intentionally-unmatched/**/*.test.ts'],
  coverage: {
    enabled: true,
    provider: 'istanbul',
    reportsDirectory: 'test-temp-no-tests-coverage',
    reporters: ['html'],
  },
});
