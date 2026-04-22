import { defineConfig } from '@rstest/core';

export default defineConfig({
  performance: {
    buildCache: {
      cacheDirectory: '.cache/mock-build-cache',
    },
  },
});
