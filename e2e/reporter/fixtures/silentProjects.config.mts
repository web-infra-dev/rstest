import { defineConfig } from '@rstest/core';

export default defineConfig({
  projects: [
    {
      name: 'silent-a',
      root: 'fixtures',
      include: ['silentProjects.test.ts'],
      silent: true,
      env: {
        RSTEST_E2E_SILENT_PROJECT: 'silent-a',
      },
    },
    {
      name: 'loud-b',
      root: 'fixtures',
      include: ['silentProjects.test.ts'],
      silent: false,
      env: {
        RSTEST_E2E_SILENT_PROJECT: 'loud-b',
      },
    },
  ],
});
