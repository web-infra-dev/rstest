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
  exclude: [
    '**/node_modules/**',
    '**/dist/**',
    '**/fixtures/**',
    '**/fixtures-*/**',
  ].concat(
    process.env.ISOLATE === 'false' ? ['**/watch/**', '**/mock/**'] : [],
  ),
});
