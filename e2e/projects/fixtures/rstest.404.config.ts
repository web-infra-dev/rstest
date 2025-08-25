import { defineConfig } from '@rstest/core';

export default defineConfig({
  projects: ['packages/*', '404'],
  globals: true,
  setupFiles: ['./setup.ts'],
});
