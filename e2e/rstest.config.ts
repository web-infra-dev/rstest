import { defineConfig } from '@rstest/core';

export default defineConfig({
  setupFiles: ['../scripts/rstest.setup.ts'],
  testTimeout: 30_000,
  slowTestThreshold: 5_000,
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
  ],
});
