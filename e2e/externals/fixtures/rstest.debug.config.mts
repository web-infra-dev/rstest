import { defineConfig } from '@rstest/core';

export default defineConfig({
  dev: {
    writeToDisk: true,
  },
  output: {
    cleanDistPath: true,
    distPath: 'dist-deps/.rstest-temp',
  },
});
