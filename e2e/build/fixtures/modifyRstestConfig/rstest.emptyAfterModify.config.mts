import {
  defineConfig,
  type RsbuildPlugin,
  type RstestExposeAPI,
} from '@rstest/core';

const hideNodeTestsPlugin = (): RsbuildPlugin => ({
  name: 'hide-node-tests',
  setup(api) {
    if (api.context.callerName !== 'rstest') {
      return;
    }

    api.useExposed<RstestExposeAPI>('rstest')?.modifyRstestConfig((config) => {
      config.include = ['missing-after-modify/**/*.test.ts'];
    });
  },
});

export default defineConfig({
  include: ['project-a.test.ts'],
  passWithNoTests: true,
  plugins: [hideNodeTestsPlugin()],
});
