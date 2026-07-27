import { defineConfig } from '@rstest/core';

/**
 * One config, two surfaces: the CLI discovers this file, and
 * `run-coverage-threshold.mjs` imports it and hands it to `createRstest`
 * (the programmatic API never reads a config file). Keeping it a single object
 * is what makes the pair assert one engine outcome — `ok: false` for the API
 * and a non-zero exit code for the CLI — instead of two configs that can drift.
 *
 * `.mjs` rather than `.ts` so the runner script can import it directly.
 */
export default defineConfig({
  include: ['*.test.ts'],
  reporters: [],
  coverage: {
    enabled: true,
    provider: 'v8',
    reporters: [],
    // The single test covers only one branch, so a 100% threshold can never be
    // met — coverage fails while every test passes.
    thresholds: {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
  },
});
