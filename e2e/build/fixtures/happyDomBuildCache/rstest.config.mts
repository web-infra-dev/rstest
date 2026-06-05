import { defineConfig } from '@rstest/core';

export default defineConfig({
  testEnvironment: 'happy-dom',
  performance: {
    buildCache: {
      cacheDirectory: '.cache/happy-dom-build-cache',
      cacheDigest: ['happy-dom-fixture'],
    },
  },
});
