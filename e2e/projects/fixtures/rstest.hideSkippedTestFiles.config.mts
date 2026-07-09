import { defineConfig } from '@rstest/core';

export default defineConfig({
  projects: [
    {
      name: 'node-hide-file',
      root: 'packages/node',
      include: ['test/allSkipped.test.ts'],
      globals: true,
      // Hide skipped test files for this project
      hideSkippedTestFiles: true,
    },
    {
      name: 'client-show-file',
      root: 'packages/client',
      include: ['test/allSkipped.test.ts'],
      globals: true,
      // Show skipped test files for this project
      hideSkippedTestFiles: false,
    },
  ],
});
