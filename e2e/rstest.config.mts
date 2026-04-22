import { defineConfig } from '@rstest/core';

/**
 * Test directories to skip in no-isolate mode.
 *
 * - watch: requires module isolation to test HMR/watch behavior
 * - mock: requires module isolation for proper mock reset between tests
 * - browser-mode: runs in browser contexts/pages, unrelated to Node.js worker isolation
 */
const NO_ISOLATE_EXCLUDES = ['watch/**', 'mock/**', 'browser-mode/**'];

export default defineConfig({
  name: 'rstest:e2e',
  setupFiles: ['../scripts/rstest.setup.ts'],
  // Increased timeout for CI to handle slower environments (e.g., Node.js 22 on Windows)
  // and reduce flaky timeouts caused by resource contention under high parallelism.
  // Use the same timeout locally because browser-mode e2e tests can exceed 15s when
  // running together with the full suite under high machine load.
  testTimeout: process.env.CI ? 60_000 : 30_000,
  // TODO(rstest): Remove CI retries after flaky e2e root causes are fixed.
  // Retry failed test cases in CI to reduce flaky failures without rerunning
  // the whole suite; keep local runs strict for faster feedback.
  retry: process.env.CI ? 2 : 0,
  slowTestThreshold: 2_000,
  // Stabilize date/time based e2e fixtures across different runner timezones.
  // Some fixtures use `new Date('YYYY-MM-DD')` (UTC parsing) but assert on local
  // calendar fields; forcing UTC makes results consistent.
  env: {
    TZ: 'UTC',
  },
  output: {
    externals: {
      react: 'commonjs react',
    },
  },
  pool: {
    // Limit to 80% of available workers to reduce "worker exited unexpectedly"
    // errors in resource-constrained environments (e.g., certain CI runners).
    maxWorkers: '80%',
    // debug warnings
    execArgv: ['--trace-warnings'],
    // `--isolate false` is more likely to hit resource contention on CI. Limit
    // worker concurrency to avoid sporadic "Worker exited unexpectedly" flakes.
    ...(process.env.ISOLATE === 'false'
      ? { maxWorkers: process.env.CI ? 1 : 2 }
      : {}),
  },
  exclude: [
    '**/node_modules/**',
    '**/dist/**',
    '**/fixtures/**',
    '**/fixtures-*/**',
    '**/flaky-fixtures/**',
  ].concat(process.env.ISOLATE === 'false' ? NO_ISOLATE_EXCLUDES : []),
});
