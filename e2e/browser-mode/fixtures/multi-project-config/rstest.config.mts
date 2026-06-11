import { defineConfig } from '@rstest/core';

export default defineConfig({
  projects: [
    './project-b/rstest.config.mts',
    './project-a/rstest.config.mts',
    // Empty node project (#1363): configured but matches zero test files, forcing
    // the mixed browser+node "no node tests to run" path that previously hung the
    // CLI (the deferred browser teardown never fired because node `run()` was
    // skipped). Keep it here so the multi-project browser tests also guard it.
    { name: 'node-empty', include: ['node-tests/**/*.test.ts'] },
  ],
});
