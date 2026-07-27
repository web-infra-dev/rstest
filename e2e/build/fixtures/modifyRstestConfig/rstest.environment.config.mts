import {
  defineConfig,
  type RsbuildPlugin,
  type RstestExposeAPI,
} from '@rstest/core';

const revealJsdomTestPlugin = (): RsbuildPlugin => ({
  name: 'reveal-jsdom-test',
  setup(api) {
    if (api.context.callerName !== 'rstest') {
      return;
    }

    api.useExposed<RstestExposeAPI>('rstest')?.modifyRstestConfig((config) => {
      config.include = ['environment.test.ts'];
      config.testEnvironment = 'jsdom';
    });
  },
});

export default defineConfig({
  include: ['ignored.test.ts', 'missing/**/*.test.ts'],
  passWithNoTests: false,
  plugins: [revealJsdomTestPlugin()],
});
