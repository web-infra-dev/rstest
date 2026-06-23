import { defineConfig } from '@rstest/core';

export default defineConfig({
  isolate: false,
  pool: {
    maxWorkers: 1,
  },
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
