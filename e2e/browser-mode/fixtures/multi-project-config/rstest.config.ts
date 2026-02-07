import { defineConfig } from '@rstest/core';

export default defineConfig({
  projects: ['./project-b/rstest.config.ts', './project-a/rstest.config.ts'],
});
