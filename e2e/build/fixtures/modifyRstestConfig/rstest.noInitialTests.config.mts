import { fileURLToPath } from 'node:url';
import {
  defineConfig,
  type RsbuildPlugin,
  type RstestExposeAPI,
} from '@rstest/core';

const revealNodeTestsPlugin = (): RsbuildPlugin => ({
  name: 'reveal-node-tests',
  setup(api) {
    if (api.context.callerName !== 'rstest') {
      return;
    }

    api.useExposed<RstestExposeAPI>('rstest')?.modifyRstestConfig((config) => {
      config.include = ['project-a.test.ts'];
      config.setupFiles = [
        fileURLToPath(new URL('./setup/project-a.ts', import.meta.url)),
      ];
      config.env = {
        ...config.env,
        RSTEST_MODIFIED_RUNTIME: 'project-a',
      };
      config.source = {
        ...config.source,
        define: {
          ...(config.source?.define || {}),
          __MODIFIED_PROJECT__: JSON.stringify('project-a'),
        },
      };
      config.resolve = {
        ...config.resolve,
        alias: {
          ...(config.resolve?.alias || {}),
          '@project-value': fileURLToPath(
            new URL('./src/project-a.ts', import.meta.url),
          ),
        },
      };
    });
  },
});

export default defineConfig({
  include: ['missing-before-modify.test.ts'],
  passWithNoTests: false,
  plugins: [revealNodeTestsPlugin()],
});
