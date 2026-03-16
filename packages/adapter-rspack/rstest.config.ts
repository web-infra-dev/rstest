import { defineConfig } from '@rstest/core';

export default defineConfig({
  root: __dirname,
  tools: {
    rspack: {
      watchOptions: {
        ignored: /test-temp-.*/,
      },
    },
  },
});
