import { defineConfig } from '@rstest/core';

export default defineConfig({
  include: ['*.test.ts'],
  pool: {
    maxWorkers: 1,
  },
});
