import { defineConfig } from '@rstest/core';
import { baseConfig } from './base.config';

export default defineConfig({
  projects: [
    {
      extends: () => Promise.resolve(baseConfig),
      name: 'project-a',
      include: ['project-a/**/*.ts'],
    },
    {
      extends: baseConfig,
      name: 'project-b',
      include: ['project-b/**/*.ts'],
    },
  ],
});
