import { defineConfig } from '@rstest/core';

export default defineConfig({
  projects: [
    {
      name: 'node-hide-skip',
      root: 'packages/node',
      include: ['test/skip.test.ts'],
      globals: true,
      // Hide skipped tests for this project
      hideSkippedTests: true,
    },
    {
      name: 'client-show-skip',
      root: 'packages/client',
      include: ['test/skip.test.ts'],
      globals: true,
      // Show skipped tests for this project
      hideSkippedTests: false,
    },
  ],
});
