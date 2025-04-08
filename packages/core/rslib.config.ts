import { defineConfig } from '@rslib/core';

export default defineConfig({
  lib: [
    {
      format: 'esm',
      syntax: ['node 16'],
      dts: {
        bundle: false,
        distPath: './dist-types',
      },
      source: {
        entry: {
          index: './src/index.ts',
          node: './src/node.ts',
          cli: './src/cli.ts',
          worker: './src/worker/index.ts',
        },
        define: {
          RSTEST_VERSION: JSON.stringify(require('./package.json').version),
        },
      },
    },
  ],
});
