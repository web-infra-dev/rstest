import { defineConfig } from '@rstest/core';

export default defineConfig({
  setupFiles: ['./rstest.setup.ts'],
  tools: {
    rspack: {
      watchOptions: {
        aggregateTimeout: 10,
      },
    },
  },
});
