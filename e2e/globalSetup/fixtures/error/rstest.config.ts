import { defineConfig } from '@rstest/core';

export default defineConfig({
  passWithNoTests: true,
  globalSetup: './globalSetup.ts',
  exclude: ['**/node_modules/**', '**/dist/**'],
});
