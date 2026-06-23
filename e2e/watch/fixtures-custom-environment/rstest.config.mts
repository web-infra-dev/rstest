import { defineConfig } from '@rstest/core';

export default defineConfig({
  testEnvironment: {
    name: './test-environment.mjs',
  },
  tools: {
    rspack: {
      watchOptions: {
        aggregateTimeout: 10,
      },
    },
  },
});
