import { defineConfig } from '@rslib/core';

export default defineConfig({
  lib: [
    {
      syntax: ['node 20'],
      source: {
        entry: {
          extension: './src/extension.ts',
        },
      },
      format: 'cjs',
      output: {
        externals: {
          vscode: 'commonjs vscode',
          '@swc/wasm': 'commonjs @swc/wasm',
        },
        sourceMap: process.env.SOURCEMAP === 'true',
      },
      tools: {
        rspack: {
          output: {
            devtoolModuleFilenameTemplate: '[absolute-resource-path]',
          },
        },
      },
    },
    {
      syntax: ['node 20'],
      format: 'cjs',
      source: {
        entry: {
          worker: './src/worker/index.ts',
        },
      },
      output: {
        externals: {
          vscode: 'commonjs vscode',
        },
        sourceMap: process.env.SOURCEMAP === 'true',
      },
      tools: {
        rspack: {
          output: {
            devtoolModuleFilenameTemplate: '[absolute-resource-path]',
          },
        },
      },
    },
  ],
  tools: {
    rspack: {
      ignoreWarnings: [/Module not found/],
    },
  },
});
