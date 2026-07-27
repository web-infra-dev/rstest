import type { RsbuildPlugin } from '@rsbuild/core';
import { defineConfig } from '@rstest/core';
import type { RstestExposeAPI } from '@rstest/core';
import { BROWSER_PORTS } from '../../ports';

const addBrowserEntriesPlugin = (): RsbuildPlugin => ({
  name: 'add-browser-entries-b',
  setup(api) {
    if (api.context.callerName !== 'rstest') {
      return;
    }

    api.useExposed<RstestExposeAPI>('rstest')?.modifyRstestConfig((config) => {
      config.include = ['tests-added/**/*.test.ts'];
    });
  },
});

export default defineConfig({
  name: 'project-hooked-b',
  include: ['initial-empty/**/*.test.ts'],
  plugins: [addBrowserEntriesPlugin()],
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS['multi-project-config-hooked-b'],
    strictPort: true,
  },
});
