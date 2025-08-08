import { defineConfig } from '@rslib/core';
import { licensePlugin } from './licensePlugin';

const isBuildWatch = process.argv.includes('--watch');

export default defineConfig({
  lib: [
    {
      id: 'rstest',
      format: 'esm',
      syntax: ['node 18'],
      dts: {
        bundle: {
          bundledPackages: [
            '@types/sinonjs__fake-timers',
            '@jridgewell/trace-mapping',
            '@vitest/expect',
            '@vitest/snapshot',
            '@vitest/utils',
            '@vitest/spy',
            'tinyrainbow',
            '@vitest/pretty-format',
          ],
        },
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
      shims: {
        esm: {
          require: true,
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
