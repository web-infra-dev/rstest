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

    const rstestApi = api.useExposed<RstestExposeAPI>('rstest');
    const rstestConfig = rstestApi?.getRstestConfig();
    const pool = rstestConfig?.pool;
    const poolType = typeof pool === 'string' ? pool : pool?.type;

    rstestApi?.modifyRstestConfig((config) => {
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
          __GET_RSTEST_CONFIG_POOL__: JSON.stringify(poolType),
          __GET_RSTEST_CONFIG_PROJECT__: JSON.stringify(rstestConfig?.name),
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
  name: 'project-a',
  include: ['missing-before-modify.test.ts'],
  passWithNoTests: false,
  pool: {
    type: 'forks',
    maxWorkers: 2,
  },
  plugins: [revealNodeTestsPlugin()],
});
