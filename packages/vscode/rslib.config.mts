import { createRequire } from 'node:module';
import { defineConfig, rspack } from '@rslib/core';
import { rslibRspackConfig } from '../../scripts/rslibConfig';
import { rsdoctorCIPlugin } from '../../scripts/rsdoctorPlugin';

const require = createRequire(import.meta.url);
const vsceTarget =
  process.env.VSCE_TARGET ?? `${process.platform}-${process.arch}`;
// Rstest's Linux VSIX targets use glibc, whose Yuku bindings have a `-gnu` suffix.
const yukuBindingSuffix = vsceTarget.startsWith('linux-')
  ? `${vsceTarget}-gnu`
  : vsceTarget;
const yukuRequire = createRequire(require.resolve('yuku-parser'));
// Yuku computes this package name at runtime, so Rspack cannot discover it.
const yukuBindingPath = yukuRequire.resolve(
  `@yuku-parser/binding-${yukuBindingSuffix}`,
);

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
        },
        sourceMap: process.env.SOURCEMAP === 'true',
      },
      tools: {
        rspack: {
          output: {
            devtoolModuleFilenameTemplate: '[absolute-resource-path]',
          },
          plugins: [
            new rspack.CopyRspackPlugin({
              patterns: [
                {
                  from: yukuBindingPath,
                  to: `@yuku-parser/binding-${yukuBindingSuffix}/yuku-parser.node`,
                },
              ],
            }),
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
          plugins: [rsdoctorCIPlugin({ reportDir: '.rsdoctor/worker' })].filter(
            Boolean,
          ),
        },
      },
    },
  ],
  tools: {
    rspack: rslibRspackConfig,
  },
});
