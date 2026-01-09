import { defineConfig } from '@rstest/core';

export default defineConfig({
  setupFiles: ['../scripts/rstest.setup.ts'],
  // Increased timeout for CI to handle slower environments (e.g., Node.js 22 on Windows)
  testTimeout: process.env.CI ? 30_000 : 10_000,
  slowTestThreshold: 2_000,
  output: {
    externals: {
      react: 'commonjs react',
    },
  },
  pool: {
    // Limit to 80% of available workers to reduce "worker exited unexpectedly"
    // errors in resource-constrained environments (e.g., certain CI runners).
    // Limit to 80% of available workers to reduce "worker exited unexpectedly"
    // errors in resource-constrained environments (e.g., certain CI runners).
    maxWorkers: '80%',
    // debug warnings
    execArgv: ['--trace-warnings'],
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
