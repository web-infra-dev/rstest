import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { defineConfig, rspack } from '@rslib/core';
import { licensePlugin } from '../core/licensePlugin';
import { rslibRspackConfig } from '../../scripts/rslibConfig';
import { rsdoctorCIPlugin } from '../../scripts/rsdoctorPlugin';

const require = createRequire(import.meta.url);
const vsceTarget =
  process.env.VSCE_TARGET ?? `${process.platform}-${process.arch}`;
// Rstest's Linux VSIX targets use glibc, whose Yuku bindings have a `-gnu` suffix.
const yukuBindingSuffix = vsceTarget.startsWith('linux-')
  ? `${vsceTarget}-gnu`
  : vsceTarget;
const yukuParserPath = require.resolve('yuku-parser');
const yukuRequire = createRequire(yukuParserPath);
const yukuParserPackage = yukuRequire(
  `${dirname(yukuParserPath)}/package.json`,
);
// Yuku computes this package name at runtime, so Rspack cannot discover it.
const yukuBindingPath = yukuRequire.resolve(
  `@yuku-parser/binding-${yukuBindingSuffix}`,
);
const yukuBindingPackage = yukuRequire(
  `${dirname(yukuBindingPath)}/package.json`,
);
// Yuku packages omit their LICENSE files; keep the upstream notice in the
// generated VSIX license: https://github.com/yuku-toolchain/yuku/blob/main/LICENSE
const yukuLicenseText = `MIT License

Copyright (c) 2026 Yuku

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

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
            // only load & apply licensePlugin in lib build
            process.argv.includes('--watch') || !process.argv.includes('build')
              ? null
              : await licensePlugin(
                  'rstest VS Code extension',
                  false,
                  ['@rstest/core', 'yuku-parser'],
                  [
                    {
                      name: yukuBindingPackage.name,
                      license: yukuBindingPackage.license,
                      licenseText: yukuLicenseText,
                      repository: yukuBindingPackage.repository.url,
                    },
                    {
                      name: yukuParserPackage.name,
                      license: yukuParserPackage.license,
                      licenseText: yukuLicenseText,
                      repository: yukuParserPackage.repository.url,
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
