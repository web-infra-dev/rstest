import { defineConfig } from '@rstest/core';

export default defineConfig({
  exclude: ['test/sourcemapMapping.test.ts'],
  setupFiles: ['./rstest.setup.ts'],
  coverage: {
    reporters: ['text'],
  },
});
