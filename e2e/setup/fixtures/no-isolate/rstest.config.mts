import { defineConfig } from '@rstest/core';

export default defineConfig({
  passWithNoTests: true,
  setupFiles: ['./rstest.setup.ts'],
  exclude: ['**/node_modules/**', '**/dist/**'],
  isolate: false,
  pool: { maxWorkers: 1 },
});
