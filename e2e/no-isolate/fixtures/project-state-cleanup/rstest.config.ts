import { defineConfig } from '@rstest/core';

export default defineConfig({
  isolate: false,
  pool: { maxWorkers: 1 },
  onConsoleLog: () => false,
  projects: [
    {
      name: 'project-a',
      include: ['project-a.test.ts'],
      globals: true,
    },
    {
      name: 'project-b',
      include: ['project-b.test.ts'],
      globals: false,
      disableConsoleIntercept: true,
      globalSetup: './waitForProjectA.ts',
    },
  ],
});
