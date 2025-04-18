import { defineConfig } from '@rstest/core';

export default defineConfig({
  setupFiles: ['./rstest.setup.ts'],
  exclude: [
    '**/node_modules/**',
    '**/dist/**',
    '**/fixtures/**',
    '**/fixtures-test/**',
  ],
});
