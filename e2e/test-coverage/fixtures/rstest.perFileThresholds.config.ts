import { defineConfig } from '@rstest/core';

export default defineConfig({
  coverage: {
    enabled: true,
    provider: 'istanbul',
    reporters: [],
    clean: false,
    thresholds: {
      'src/**': {
        perFile: true,
        statements: 100,
      },
    },
  },
  setupFiles: ['./rstest.setup.ts'],
});
