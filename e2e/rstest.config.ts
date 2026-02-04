import { defineConfig } from '@rstest/core';

export default defineConfig({
  setupFiles: ['../scripts/rstest.setup.ts'],
  // Increased timeout for CI to handle slower environments (e.g., Node.js 22 on Windows)
  // and reduce flaky timeouts caused by resource contention under high parallelism.
  testTimeout: process.env.CI ? 60_000 : 10_000,
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
    ...(process.env.ISOLATE === 'false' ? { maxWorkers: 2 } : {}),
  },
  exclude: [
    '**/node_modules/**',
    '**/dist/**',
    '**/fixtures/**',
    '**/fixtures-*/**',
  ].concat(
    process.env.ISOLATE === 'false' ? ['**/watch/**', '**/mock/**'] : [],
  ),
});
