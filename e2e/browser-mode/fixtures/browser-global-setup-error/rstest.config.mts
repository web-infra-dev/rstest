import { defineConfig } from '@rstest/core';

// Each browser project fails independently so the shared setup stage must
// preserve every error instead of reporting only the first project.
export default defineConfig({
  projects: ['./project-a/rstest.config.mts', './project-b/rstest.config.mts'],
});
