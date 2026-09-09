import { fileURLToPath } from 'node:url';
import {
  defineConfig,
  type RsbuildPlugin,
  type RstestExposeAPI,
} from '@rstest/core';

const modifyRstestConfigPlugin = (projectName: string): RsbuildPlugin => ({
  name: `modify-rstest-config-${projectName}`,
  setup(api) {
    if (api.context.callerName !== 'rstest') {
      return;
    }

    const rstestApi = api.useExposed<RstestExposeAPI>('rstest');
    const rstestConfig = rstestApi?.getRstestConfig();
    const pool = rstestConfig?.pool;
    const poolType = typeof pool === 'string' ? pool : pool?.type;

    rstestApi?.modifyRstestConfig((config) => {
      const setupFiles = Array.isArray(config.setupFiles)
        ? config.setupFiles
        : config.setupFiles
          ? [config.setupFiles]
          : [];

      config.include = [`${projectName}.test.ts`];
      config.setupFiles = [
        ...setupFiles,
        fileURLToPath(new URL(`./setup/${projectName}.ts`, import.meta.url)),
      ];
      config.env = {
        ...config.env,
        RSTEST_MODIFIED_RUNTIME: projectName,
      };
      config.source = {
        ...config.source,
        define: {
          ...(config.source?.define || {}),
          __GET_RSTEST_CONFIG_PROJECT__: JSON.stringify(rstestConfig?.name),
          __MODIFIED_PROJECT__: JSON.stringify(projectName),
          __GET_RSTEST_CONFIG_POOL__: JSON.stringify(poolType),
        },
      };
      config.resolve = {
        ...config.resolve,
        alias: {
          ...(config.resolve?.alias || {}),
          '@project-value': fileURLToPath(
            new URL(`./src/${projectName}.ts`, import.meta.url),
          ),
        },
      };
    });
  },
});

const returnRstestConfigPlugin = (projectName: string): RsbuildPlugin => ({
  name: `return-rstest-config-${projectName}`,
  setup(api) {
    if (api.context.callerName !== 'rstest') {
      return;
    }

    const rstestApi = api.useExposed<RstestExposeAPI>('rstest');
    const rstestConfig = rstestApi?.getRstestConfig();
    const pool = rstestConfig?.pool;
    const poolType = typeof pool === 'string' ? pool : pool?.type;

    rstestApi?.modifyRstestConfig((config) => ({
      include: [`<rootDir>/${projectName}.test.ts`],
      setupFiles: [`<rootDir>/setup/${projectName}.ts`],
      env: {
        ...config.env,
        RSTEST_MODIFIED_RUNTIME: projectName,
      },
      source: {
        ...config.source,
        define: {
          ...(config.source?.define || {}),
          __GET_RSTEST_CONFIG_PROJECT__: JSON.stringify(rstestConfig?.name),
          __MODIFIED_PROJECT__: JSON.stringify(projectName),
          __GET_RSTEST_CONFIG_POOL__: JSON.stringify(poolType),
        },
      },
      resolve: {
        ...config.resolve,
        alias: {
          ...(config.resolve?.alias || {}),
          '@project-value': fileURLToPath(
            new URL(`./src/${projectName}.ts`, import.meta.url),
          ),
        },
      },
    }));
  },
});

export default defineConfig({
  pool: {
    type: 'forks',
    maxWorkers: 2,
  },
  projects: [
    {
      name: 'project-a',
      plugins: [modifyRstestConfigPlugin('project-a')],
    },
    {
      name: 'project-b',
      plugins: [modifyRstestConfigPlugin('project-b')],
    },
    {
      name: 'return-project',
      plugins: [returnRstestConfigPlugin('return-project')],
    },
  ],
});
