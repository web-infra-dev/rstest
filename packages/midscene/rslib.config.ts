import { defineConfig } from '@rslib/core';

export default defineConfig({
  lib: [
    // Browser-side code (runs in test runner iframe)
    {
      format: 'esm',
      syntax: ['chrome 100'],
      dts: true,
      source: {
        entry: {
          index: './src/index.ts',
        },
      },
      output: {
        sourceMap: process.env.SOURCEMAP === 'true',
      },
    },
    // Node.js-side code (RsbuildPlugin, runs on host)
    {
      format: 'esm',
      syntax: ['node 18'],
      dts: true,
      source: {
        entry: {
          plugin: './src/plugin.ts',
          hostWebPage: './src/hostWebPage.ts',
        },
      },
      output: {
        sourceMap: process.env.SOURCEMAP === 'true',
        // Mark playwright and @rstest/browser as external
        externals: ['playwright', '@rstest/browser', '@rsbuild/core', 'dotenv'],
      },
    },
  ],
});
