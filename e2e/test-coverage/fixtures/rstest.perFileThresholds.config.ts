import { defineConfig } from '@rstest/core';

export default defineConfig({
  coverage: {
    enabled: true,
    provider: 'istanbul',
    reporters: [],
    thresholds: {
      'src/**': {
        perFile: true,
        statements: 100,
      },
    },
  },
  setupFiles: ['./rstest.setup.ts'],
});
