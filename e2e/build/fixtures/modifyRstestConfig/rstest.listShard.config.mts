import {
  defineConfig,
  type RsbuildPlugin,
  type RstestExposeAPI,
} from '@rstest/core';

const revealListShardTestsPlugin = (): RsbuildPlugin => ({
  name: 'reveal-list-shard-tests',
  setup(api) {
    if (api.context.callerName !== 'rstest') {
      return;
    }

    api.useExposed<RstestExposeAPI>('rstest')?.modifyRstestConfig((config) => {
      config.include = [
        'shard-a.test.ts',
        'shard-b.test.ts',
        'shard-c.test.ts',
      ];
    });
  },
});

export default defineConfig({
  include: ['shard-c.test.ts'],
  plugins: [revealListShardTestsPlugin()],
});
