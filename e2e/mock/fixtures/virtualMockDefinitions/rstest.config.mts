import { defineConfig } from '@rstest/core';

export default defineConfig({
  resolve: {
    alias: {
      'virtual-alias': false,
    },
  },
});
