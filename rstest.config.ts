import { defineConfig } from '@rstest/core';

export default defineConfig({
  projects: ['packages/*', 'examples/*'],
  globals: true,
  setupFiles: ['./scripts/rstest.setup.ts'],
});
