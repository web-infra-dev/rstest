import { defineConfig } from '@rstest/core';

export default defineConfig({
  exclude: ['test/sourcemapMapping.test.ts', 'allow-external/**'],
  coverage: {
    enabled: true,
    reporters: [],
    clean: false,
    thresholds: {
      statements: 100,
      lines: -1,
    },
  },
  setupFiles: ['./rstest.setup.ts'],
});
