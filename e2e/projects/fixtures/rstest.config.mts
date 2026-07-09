import { defineConfig } from '@rstest/core';

export default defineConfig({
  projects: ['packages/*'],
  globals: true,
  setupFiles: ['./setup.ts'],
});
