import { defineConfig } from '@rstest/core';

export default defineConfig({
  pool: {
    type: 'vmThreads',
    maxWorkers: 1,
    memoryLimit: '256MB',
  },
  output: {
    bundleDependencies: true,
    externals: ['test-interop/realm.mjs'],
  },
});
