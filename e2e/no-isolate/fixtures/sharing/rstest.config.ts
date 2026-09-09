import { defineConfig } from '@rstest/core';

export default defineConfig({
  isolate: false,
  // jsdom so the capture guards (domCapture.ts + capture*.test.ts) can lock
  // the environment lifetime to the module lifetime; every other fixture file
  // is environment-agnostic.
  testEnvironment: 'jsdom',
  setupFiles: ['./setup.ts'],
  // Lets the surface guard assert a mock from a persisted `rstest` reference is
  // reset per test (surfaceHelper.ts), and drives the shared-module mock reset
  // in mockShareA/mockShareB.
  clearMocks: true,
  // One worker so module sharing is deterministic.
  pool: { maxWorkers: 1 },
});
