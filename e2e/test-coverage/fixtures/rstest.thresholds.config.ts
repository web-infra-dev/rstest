import { defineConfig } from '@rstest/core';

export default defineConfig({
  coverage: {
    enabled: true,
    provider: 'istanbul',
    reporters: [],
    clean: false,
    thresholds: {
      statements: 100,
      lines: -1,
    },
  },
  setupFiles: ['./rstest.setup.ts'],
});
