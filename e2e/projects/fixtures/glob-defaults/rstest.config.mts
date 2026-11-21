import { defineConfig } from '@rstest/core';

export default defineConfig({
  projects: [
    {
      glob: 'packages/*',
      extends: { include: ['unit.case.ts'], setupFiles: ['./setup.ts'] },
    },
  ],
});
