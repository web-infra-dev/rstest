import { defineConfig } from '@rstest/core';

export default defineConfig({
  exclude: ['test/sourcemapMapping.test.ts'],
  coverage: {
    enabled: true,
    provider: 'istanbul',
    reporters: [],
    clean: false,
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
