import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createRequire } from 'node:module';
import { defineConfig, rspack } from '@rslib/core';
import { licensePlugin } from '../core/licensePlugin';
import { rslibRspackConfig } from '../../scripts/rslibConfig';
import { rsdoctorCIPlugin } from '../../scripts/rsdoctorPlugin';

const vsceTarget =
  process.env.VSCE_TARGET ?? `${process.platform}-${process.arch}`;
// The published Linux VSIX targets use glibc and Windows targets use MSVC.
const swcNextBindingSuffix = vsceTarget.startsWith('linux-')
  ? `${vsceTarget}-gnu`
  : vsceTarget.startsWith('win32-')
    ? `${vsceTarget}-msvc`
    : vsceTarget;
const swcNextRequire = createRequire(import.meta.resolve('@swc-next/parser'));
// SWC Next computes this package name at runtime, so Rspack cannot discover it.
const swcNextBindingPath = swcNextRequire.resolve(
  `@swc-next/parser-binding-${swcNextBindingSuffix}`,
);

const swcNextBindingPackage = swcNextRequire(
  `${dirname(swcNextBindingPath)}/package.json`,
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
                  from: swcNextBindingPath,
                  // The bundled loader resolves its local binary next to this chunk.
                  to: `swc-next-parser.${swcNextBindingSuffix}.node`,
                },
              ],
            }),
            // The native binary is copied, so the license scanner cannot discover it.
            process.argv.includes('--watch') || !process.argv.includes('build')
              ? null
              : await licensePlugin(
                  'rstest VS Code extension',
                  false,
                  ['@rstest/core'],
                  [
                    {
                      name: swcNextBindingPackage.name,
                      license: swcNextBindingPackage.license,
                      licenseText: readFileSync(
                        `${dirname(swcNextBindingPath)}/LICENSE`,
                        'utf8',
                      ),
                      repository: swcNextBindingPackage.repository.url,
                    },
                  ],
                ),
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
