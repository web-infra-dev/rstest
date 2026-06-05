import { defineConfig } from '@rstest/core';

export default defineConfig({
  isolate: false,
  setupFiles: ['./setup.ts'],
  // Lets the surface guard assert a mock from a persisted `rstest` reference is
  // reset per test (surfaceSecond.test.ts); no-op for the other fixtures.
  clearMocks: true,
  // One worker so module sharing is deterministic.
  pool: { maxWorkers: 1, minWorkers: 1 },
});
