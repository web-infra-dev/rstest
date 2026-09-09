import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS } from '../../ports';

// Real browser project whose `include` matches no files on disk. It is still a
// `browser.enabled` project, so it is served like any other; the run must not
// hang or fail because it contributes zero test files.
export default defineConfig({
  name: 'project-empty',
  include: ['tests/**/*.browsertest.ts'],
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS['browser-empty-project'],
  },
});
