import { defineConfig } from '@rstest/core';

export default defineConfig({
  setupFiles: ['../scripts/rstest.setup.ts'],
  testTimeout: process.env.CI ? 20_000 : 10_000,
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
    process.env.ISOLATE === 'false' ? '**/watch/**' : '',
  ].filter(Boolean),
});
