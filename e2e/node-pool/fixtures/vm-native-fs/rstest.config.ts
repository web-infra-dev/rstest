import { defineConfig } from '@rstest/core';

export default defineConfig({
  pool: { type: 'vmForks', maxWorkers: 1 },
  clearMocks: false,
  resetMocks: false,
  restoreMocks: false,
  setupFiles: ['./setup.ts'],
});
