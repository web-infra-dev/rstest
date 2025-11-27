import { defineConfig, rspack } from '@rslib/core';
import { licensePlugin } from './licensePlugin';
import { version } from './package.json';

const isBuildWatch = process.argv.includes('--watch');

export default defineConfig({
  lib: [
    {
      id: 'rstest',
      format: 'esm',
      syntax: ['node 18'],
      experiments: {
        advancedEsm: true,
      },
      dts: {
        bundle: {
          bundledPackages: [
            '@types/sinonjs__fake-timers',
            '@types/istanbul-reports',
            '@types/istanbul-lib-report',
            '@types/istanbul-lib-coverage',
            '@jridgewell/trace-mapping',
            '@vitest/expect',
            '@vitest/snapshot',
            '@vitest/utils',
            '@vitest/spy',
            'tinyrainbow',
            '@vitest/pretty-format',
          ],
        },
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
      shims: {
        esm: {
          require: true,
        },
      },
      source: {
        entry: {
          index: './src/index.ts',
          worker: './src/runtime/worker/index.ts',
        },
        define: {
          RSTEST_VERSION: JSON.stringify(version),
        },
      },
      tools: {
        rspack: {
          // fix licensePlugin watch error: ResourceData has been dropped by Rust.
          plugins: [
            new rspack.CopyRspackPlugin({
              patterns: [
                {
                  from: 'src/core/plugins/mockRuntimeCode.js',
                  to: 'mockRuntimeCode.js',
                },
                {
                  from: 'src/core/plugins/importActualLoader.mjs',
                  to: 'importActualLoader.mjs',
                },
              ],
            }),
            isBuildWatch ? null : licensePlugin(),
          ].filter(Boolean),
        },
      },
    },
    {
      id: 'rstest_loaders',
      format: 'esm',
      syntax: 'es2021',
      dts: false,
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
  performance: {
    printFileSize: !isBuildWatch,
  },
  tools: {
    rspack: {
      watchOptions: {
        ignored: /\.git/,
      },
    },
  },
});
