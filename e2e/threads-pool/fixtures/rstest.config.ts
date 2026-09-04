import { defineConfig } from '@rstest/core';

export default defineConfig({
  include: ['./test/**/*.test.ts'],
  pool: {
    type: 'threads',
    maxWorkers: 1,
  },
  testEnvironment: 'jsdom',
});
