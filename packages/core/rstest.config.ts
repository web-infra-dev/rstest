import { defineConfig } from '@rstest/core';

export default defineConfig({
  setupFiles: ['../../scripts/rstest.setup.ts'],
  globals: true,
});
