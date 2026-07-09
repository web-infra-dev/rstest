import { defineConfig } from '@rstest/core';

export default defineConfig({
  projects: [
    './project-b/rstest.config.mts',
    './project-a/rstest.config.mts',
    // Empty node project (#1363): configured but matches zero test files, forcing
    // the mixed browser+node "no node tests to run" path that previously hung the
    // CLI. Keep it here so the multi-project browser tests also guard that this
    // filtered node project never creates a Rsbuild compiler/server.
    {
      name: 'node-empty',
      include: ['node-tests/**/*.test.ts'],
      plugins: [
        {
          name: 'node-empty-compiler-guard',
          setup(api) {
            api.onAfterCreateCompiler(() => {
              throw new Error('NODE_EMPTY_SHOULD_NOT_CREATE_COMPILER');
            });
          },
        },
      ],
    },
  ],
});
