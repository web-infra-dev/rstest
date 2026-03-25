import { defineConfig } from '@rslib/core';
import { rsdoctorCIPlugin } from '../../scripts/rsdoctorPlugin.ts';

export default defineConfig({
  lib: [
    {
      syntax: 'es2023',
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
          plugins: [
            rsdoctorCIPlugin({ reportDir: '.rsdoctor/extension' }),
          ].filter(Boolean),
        },
      },
    },
    {
      syntax: 'es2023',
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
          plugins: [
            rsdoctorCIPlugin({ reportDir: '.rsdoctor/worker' }),
          ].filter(Boolean),
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
