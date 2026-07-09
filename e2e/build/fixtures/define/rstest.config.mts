import { defineConfig } from '@rstest/core';

export default defineConfig({
  name: 'node',
  source: {
    define: {
      RSBUILD_VERSION: JSON.stringify(require('@rsbuild/core').version),
    },
  },
});
