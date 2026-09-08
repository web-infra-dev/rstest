import { defineConfig } from '@rstest/core';

export default defineConfig({
  pool: {
    type: 'vmThreads',
    maxWorkers: 1,
  },
  testEnvironment: {
    name: 'jsdom',
    options: {
      beforeParse() {},
    },
  },
});
