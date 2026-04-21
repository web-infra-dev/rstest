import { defineConfig } from '@rstest/core';

export default defineConfig({
  include: ['./fixtures/buildCache/index.test.ts'],
  performance: {
    buildCache: {
      cacheDirectory: '.cache/build-cache-fixture',
      cacheDigest: ['fixture-digest'],
      buildDependencies: ['./extra-dependency.txt'],
    },
  },
});
