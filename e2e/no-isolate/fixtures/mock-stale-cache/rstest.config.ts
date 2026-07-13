import { defineConfig } from '@rstest/core';

export default defineConfig({
  isolate: false,
  setupFiles: ['./setup.ts'],
  // One worker so both files share a module registry deterministically.
  pool: { maxWorkers: 1 },
});
