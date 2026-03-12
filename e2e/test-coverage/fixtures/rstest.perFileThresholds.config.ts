import { defineConfig } from '@rstest/core';

export default defineConfig({
  exclude: ['test/sourcemapMapping.test.ts', 'allow-external/**'],
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
