import { defineConfig } from '@rstest/core';

// `buildDependencies` uses a config-relative path so the test can prove the
// resolved path is anchored at this file's directory (nested/), not the run root.
export default defineConfig({
  reporters: [],
  performance: {
    buildCache: {
      buildDependencies: ['./extra.js'],
    },
  },
});
