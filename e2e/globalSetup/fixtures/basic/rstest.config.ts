import { defineConfig } from '@rstest/core';

export default defineConfig({
  globalSetup: ['./setups/defaultExport.ts', './setups/namedExports.ts'],
});
