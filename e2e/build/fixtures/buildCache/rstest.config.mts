import { defineConfig } from '@rstest/core';

export default defineConfig({
  performance: {
    buildCache: {
      cacheDirectory: '.cache/build-cache-fixture',
      cacheDigest: ['fixture-digest'],
      buildDependencies: ['./extra-dependency.txt'],
    },
  },
});
