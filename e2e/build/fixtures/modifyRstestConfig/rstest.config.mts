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
          __MODIFIED_PROJECT__: JSON.stringify(projectName),
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

export default defineConfig({
  projects: [
    {
      name: 'project-a',
      plugins: [modifyRstestConfigPlugin('project-a')],
    },
    {
      name: 'project-b',
      plugins: [modifyRstestConfigPlugin('project-b')],
    },
  ],
});
