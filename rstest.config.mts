import { defineConfig } from '@rstest/core';

export default defineConfig({
  projects: ['packages/*'],
  name: 'rstest:unit',
});
