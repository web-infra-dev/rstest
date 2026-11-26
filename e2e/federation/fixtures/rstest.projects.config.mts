import { defineConfig } from '@rstest/core';

export default defineConfig({
  isolate: false,
  pool: { maxWorkers: 1 },
  projects: ['mf-a', 'plain', 'mf-b'].map((name) => ({
    name,
    include: ['projects.test.ts'],
    federation: name !== 'plain',
    disableConsoleIntercept: true,
    env: { RSTEST_E2E_MF_PROJECT: name },
  })),
});
