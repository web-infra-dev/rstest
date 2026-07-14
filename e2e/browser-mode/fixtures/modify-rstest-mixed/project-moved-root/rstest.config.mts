import type { RsbuildPlugin } from '@rsbuild/core';
import { defineConfig } from '@rstest/core';
import type { RstestExposeAPI } from '@rstest/core';
import { BROWSER_PORTS } from '../../ports';

const moveRootPlugin = (): RsbuildPlugin => ({
  name: 'move-root',
  setup(api) {
    if (api.context.callerName !== 'rstest') {
      return;
    }

    api.useExposed<RstestExposeAPI>('rstest')?.modifyRstestConfig((config) => {
      config.root = '..';
      config.include = ['src/**/*.test.ts'];
    });
  },
});

export default defineConfig({
  name: 'project-moved-root',
  root: 'project-moved-root/initial-root',
  include: ['initial-empty/**/*.test.ts'],
  plugins: [moveRootPlugin()],
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: true,
    port: BROWSER_PORTS['multi-project-config'],
  },
});
