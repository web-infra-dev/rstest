import { defineConfig } from '@rstest/core';

export default defineConfig({
  passWithNoTests: true,
  globalSetup: ['./setups/defaultExport.ts', './setups/namedExports.ts'],
  exclude: ['**/node_modules/**', '**/dist/**'],
});
