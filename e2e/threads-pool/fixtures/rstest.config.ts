import { defineConfig } from '@rstest/core';

export default defineConfig({
  pool: {
    type: 'threads',
    maxWorkers: 1,
  },
  testEnvironment: 'jsdom',
});
