import { defineConfig } from '@rstest/core';

export default defineConfig({
  dev: {
    writeToDisk: true,
  },
  output: {
    distPath: {
      root: 'custom/.rstest-temp',
    },
  },
});
