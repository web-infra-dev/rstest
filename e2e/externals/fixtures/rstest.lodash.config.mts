import { defineConfig } from '@rstest/core';

export default defineConfig({
  dev: {
    writeToDisk: true,
  },
  output: {
    module: true,
    externals: {
      // TODO: support find test-lodash from ./test-pkg/node_modules/
      // 'test-lodash': 'commonjs test-lodash',
      'test-lodash': 'commonjs ./test-pkg/node_modules/test-lodash',
    },
  },
});
