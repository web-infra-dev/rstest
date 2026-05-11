import { defineConfig } from '@rstest/core';

export default defineConfig({
  include: ['./fixtures/happyDomBuildCache/index.test.ts'],
  testEnvironment: 'happy-dom',
  performance: {
    buildCache: {
      cacheDirectory: '.cache/happy-dom-build-cache',
      cacheDigest: ['happy-dom-fixture'],
      buildDependencies: ['./fixtures/happyDomBuildCache/rstest.config.mts'],
    },
  },
});
