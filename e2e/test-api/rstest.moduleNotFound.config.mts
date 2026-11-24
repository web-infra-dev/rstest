import { defineConfig } from '@rstest/core';

export default defineConfig({
  projects: [
    { name: 'external' },
    { name: 'bundled', output: { bundleDependencies: true } },
  ],
});
