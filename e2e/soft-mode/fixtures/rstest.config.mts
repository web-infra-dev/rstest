import { defineConfig } from '@rstest/core';

export default defineConfig({
  experiments: {
    softMode: true,
  },
  testEnvironment: 'jsdom',
  // Force a single worker so file-a runs before file-b deterministically.
  // The fixture asserts cross-file state-reset semantics that only
  // exercise the soft-mode code path when both files share one worker.
  pool: {
    maxWorkers: 1,
  },
  setupFiles: ['./test/setup-spy.ts'],
});
