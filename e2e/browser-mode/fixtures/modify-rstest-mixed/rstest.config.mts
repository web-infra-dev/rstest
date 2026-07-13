import { defineConfig } from '@rstest/core';

export default defineConfig({
  projects: [
    './project-hooked-browser/rstest.config.mts',
    './project-hooked-a/rstest.config.mts',
    './project-hooked-b/rstest.config.mts',
    './project-moved-root/rstest.config.mts',
    './node-smoke/rstest.config.mts',
  ],
});
