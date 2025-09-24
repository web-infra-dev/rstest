import { defineConfig } from '@rstest/core';

export default defineConfig({
  coverage: {
    enabled: true,
    provider: 'istanbul',
    reporters: [],
    thresholds: {
      'node/**': {
        statements: 90,
      },
      'src/**': {
        statements: 100,
      },
    },
  },
  setupFiles: ['./rstest.setup.ts'],
});
