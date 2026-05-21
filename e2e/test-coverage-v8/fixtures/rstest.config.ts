import { defineConfig } from '@rstest/core';

export default defineConfig({
  exclude: ['test/sourcemapMapping.test.ts', 'allow-external/**'],
  setupFiles: ['./rstest.setup.ts'],
  coverage: {
    reporters: ['text'],
  },
});
