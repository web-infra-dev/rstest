import { defineConfig } from '@rstest/core';

/**
 * Multi-project run where one node project matches test files (and is built) and
 * a sibling node project matches zero test files (so it is never built this
 * round). `coverage.include` matches source under both project roots.
 *
 * Regression guard: `generateCoverage` must only instrument untested files for
 * the projects built this round. Instrumenting the unbuilt sibling would call
 * the istanbul swc transform for an environment that was never registered,
 * throwing `... swc transform function for <env> is not registered`.
 *
 * The "built" project reuses an existing fixture test so no new `*.test.ts` is
 * added under `fixtures/` (which the other coverage configs scan). The unbuilt
 * sibling is a source-only directory; `coverage.include` (`src/**`) is anchored,
 * so the other configs never pick it up.
 */
export default defineConfig({
  projects: [
    { name: 'built', include: ['test/array.test.ts'] },
    {
      name: 'unbuilt',
      root: 'unbuilt-sibling-orphan',
      // Intentionally match no test files so this project is never built.
      include: ['__no_such_dir__/**/*.test.ts'],
    },
  ],
  coverage: {
    enabled: true,
    provider: 'istanbul',
    reporters: ['text'],
    include: ['src/**/*.ts'],
  },
});
