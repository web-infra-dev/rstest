import { defineConfig } from '@rstest/core';

// Phase 5 step 5 gate: in a mixed run each project's own `globalSetup` runs,
// the node test reads its var via `process.env`, and the browser test reads
// its var via `import.meta.env`. The browser test file lives at a filterable
// path so a CLI file filter can select only the browser side (regression gate
// for the mixed-path global teardown drain when no node tests run).
export default defineConfig({
  projects: [
    './project-node/rstest.config.mts',
    './project-browser/rstest.config.mts',
  ],
});
