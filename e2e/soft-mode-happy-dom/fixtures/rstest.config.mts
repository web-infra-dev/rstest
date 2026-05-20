import { defineConfig } from '@rstest/core';

export default defineConfig({
  experiments: {
    softMode: true,
  },
  testEnvironment: 'happy-dom',
  // Force single worker so file-a always precedes file-b — assertions
  // about cross-file state reset are deterministic.
  pool: {
    maxWorkers: 1,
  },
  setupFiles: ['./test/setup.ts'],
});
