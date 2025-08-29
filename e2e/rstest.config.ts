import { defineConfig } from '@rstest/core';

export default defineConfig({
  setupFiles: ['../scripts/rstest.setup.ts'],
  testTimeout: process.env.CI ? 10_000 : 5_000,
  globals: true,
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
  ],
});
