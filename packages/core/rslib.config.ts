import { defineConfig } from '@rslib/core';
import { LicenseWebpackPlugin } from 'license-webpack-plugin';
import type { LicenseIdentifiedModule } from 'license-webpack-plugin/dist/LicenseIdentifiedModule';

const isBuildWatch = process.argv.includes('--watch');

export default defineConfig({
  lib: [
    {
      id: 'rstest',
      format: 'esm',
      syntax: ['node 18'],
      dts: {
        bundle: true,
        distPath: './dist-types',
      },
      output: {
        externals: {
          // Temporary fix: `import * as timers from 'timers'` reassign error
          timers: 'commonjs timers',
          'timers/promises': 'commonjs timers/promises',
          // fix deduplicate import from fs & node:fs
          fs: 'node:fs',
          os: 'node:os',
          tty: 'node:tty',
          util: 'node:util',
          path: 'node:path',
        },
        minify: {
          jsOptions: {
            minimizerOptions: {
              mangle: false,
              minify: false,
              compress: {
                defaults: false,
                unused: true,
                dead_code: true,
                toplevel: true,
                // fix `Couldn't infer stack frame for inline snapshot` error
                // should keep function name used to filter stack trace
                keep_fnames: true,
              },
              format: {
                comments: 'some',
                preserve_annotations: true,
              },
            },
          },
        },
      },
      source: {
        entry: {
          public: './src/public.ts',
          node: './src/node.ts',
          cli: './src/cli/index.ts',
          worker: './src/runtime/worker/index.ts',
        },
        define: {
          RSTEST_VERSION: JSON.stringify(require('./package.json').version),
        },
      },
      tools: {
        rspack: {
          // fix licensePlugin watch error: ResourceData has been dropped by Rust.
          plugins: isBuildWatch ? [] : [licensePlugin()],
        },
      },
    },
    {
      id: 'rstest_loaders',
      format: 'esm',
      syntax: 'es2021',
      source: {
        entry: {
          cssFilterLoader: './src/core/plugins/css-filter/loader.ts',
        },
      },
      output: {
        filename: {
          js: '[name].mjs',
        },
      },
    },
  ],
  tools: {
    rspack: {
      watchOptions: {
        ignored: /\.git/,
      },
    },
  },
});

function licensePlugin() {
  const formatLicenseTitle = (module: LicenseIdentifiedModule) => {
    // @ts-ignore
    const gitUrl = module.packageJson?.repository?.url;
    return `Licensed under ${module.licenseId} license${
      gitUrl ? ` in the repository at ${gitUrl}` : ''
    }.`;
  };

  const formatLicenseText = (license: string) => {
    return license
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n');
  };

  return new LicenseWebpackPlugin({
    perChunkOutput: false,
    outputFilename: '../LICENSE',
    renderLicenses: (modules: LicenseIdentifiedModule[]) => {
      return `MIT License

Copyright (c) 2023-present Bytedance, Inc. and its affiliates.

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


## Third-party licenses

The following third-party packages are bundled into @rstest/core.

${modules
  .sort((left, right) => {
    return left.name < right.name ? -1 : 1;
  })
  .reduce((file, module) => {
    return `${file}### ${module.name}${
      module.licenseId ? `\n\n${formatLicenseTitle(module)}` : ''
    }${module.licenseText ? `\n\n${formatLicenseText(module.licenseText)}` : ''}\n\n`;
  }, '')
  .trim()}\n`;
    },
  });
}
