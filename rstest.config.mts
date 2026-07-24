import { defineConfig } from '@rstest/core';

export default defineConfig({
  // `lint` is a project of its own (config in scripts/lint/rstest.config.ts):
  // it holds tests for repo-level lint tooling that lives outside any package,
  // such as the custom rslint rule in rslint.config.mts.
  projects: ['packages/*', 'scripts/lint'],
  name: 'rstest:unit',
});
