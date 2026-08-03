import { defineConfig } from '@rstest/core';

export default defineConfig({
  projects: [
    {
      name: 'cleanup-owner-a',
      include: ['fixtures/workerCleanupProjectA.test.ts'],
      extends: {
        silent: 'passed-only',
      },
    },
    {
      name: 'cleanup-owner-b',
      include: ['fixtures/workerCleanupProjectB.test.ts'],
      disableConsoleIntercept: true,
      extends: {
        silent: 'passed-only',
      },
    },
  ],
});
