import { defineConfig } from '@rstest/core';

export default defineConfig({
  tools: {
    rspack: {
      watchOptions: {
        aggregateTimeout: 10,
      },
    },
  },
});
