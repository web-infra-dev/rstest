import { defineConfig } from '@rstest/core';

export default defineConfig({
  exclude: ['test/sourcemapMapping.test.ts', 'allow-external/**'],
  coverage: {
    enabled: true,
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
