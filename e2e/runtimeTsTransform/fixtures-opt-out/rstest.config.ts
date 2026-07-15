import { defineConfig } from '@rstest/core';

export default defineConfig({
  include: ['*.test.ts'],
  runtimeTsTransform: false,
  pool: {
    maxWorkers: 1,
  },
});
