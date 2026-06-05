import { defineConfig } from '@rstest/core';

export default defineConfig({
  dev: {
    writeToDisk: true,
  },
  output: {
    cleanDistPath: true,
    bundleDependencies: ['test-interop/index.js'],
    distPath: 'dist-deps/.rstest-temp',
  },
});
