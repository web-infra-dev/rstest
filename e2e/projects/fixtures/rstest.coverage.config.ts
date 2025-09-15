import { defineConfig } from '@rstest/core';

export default defineConfig({
  projects: ['packages/*'],
  globals: true,
  coverage: {
    enabled: true,
  },
  setupFiles: ['./setup.ts'],
});
