import { defineConfig } from '@rstest/core';

// Two browser projects with independent sources. Watch-mode chunk-hash
// baselines are keyed per project; a change in project-b after a change in
// project-a must still be detected (regression: a shared flat baseline let one
// project's compile clobber the other's diff state).
export default defineConfig({
  projects: ['./project-a/rstest.config.mts', './project-b/rstest.config.mts'],
});
