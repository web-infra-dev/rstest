import { defineConfig } from '@rstest/core';

export default defineConfig({
  source: {
    assetsInclude: /\.(txt|md)$/,
  },
});
