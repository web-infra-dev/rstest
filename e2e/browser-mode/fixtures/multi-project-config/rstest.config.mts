import { defineConfig } from '@rstest/core';

export default defineConfig({
  projects: ['./project-b/rstest.config.mts', './project-a/rstest.config.mts'],
});
