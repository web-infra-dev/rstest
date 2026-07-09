import { defineConfig } from '@rstest/core';

export default defineConfig({
  dev: {
    writeToDisk: true,
  },
  output: {
    cleanDistPath: true,
    bundleDependencies: ['test-lodash'],
    distPath: 'dist-deps/.rstest-temp',
  },
});
