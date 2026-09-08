import { defineConfig } from '@rstest/core';

export default defineConfig({
  projects: [
    {
      name: 'no-color',
      include: ['configuredProject.test.ts'],
      env: {
        NO_COLOR: '1',
      },
    },
    {
      name: 'default-color',
      include: ['fallbackProject.test.ts'],
    },
  ],
});
