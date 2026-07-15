import { defineConfig } from '@rstest/core';

export default defineConfig({
  include: ['*.test.ts'],
  setupFiles: ['./setupTsExtension.ts'],
  pool: {
    maxWorkers: 1,
  },
});
