import { defineConfig } from '@rstest/core';

// Two browser projects: one matches zero test files, one has a real test. The
// empty browser project must still get its own dev server / container origin
// (Phase 4 step 3 preserves today's behavior — every `browser.enabled` project
// is served), and its emptiness must not hang or fail the run.
export default defineConfig({
  projects: [
    './project-empty/rstest.config.mts',
    './project-full/rstest.config.mts',
  ],
});
