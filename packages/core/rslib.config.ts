import { defineConfig } from '@rslib/core';
import { isCI } from 'std-env';

const isRunningInRstestCi =
  isCI &&
  process.env.GITHUB_ACTIONS &&
  process.env.GITHUB_REPOSITORY === 'web-infra-dev/rstest';

export default defineConfig({
  lib: [
    {
      format: 'esm',
      syntax: ['node 16'],
      dts: {
        bundle: false,
        distPath: './dist-types',
      },
      output: {
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
          index: './src/index.ts',
          node: './src/node.ts',
          cli: './src/cli.ts',
          worker: './src/worker/index.ts',
        },
        define: {
          RSTEST_VERSION: JSON.stringify(require('./package.json').version),
          RSTEST_SELF_CI: JSON.stringify(isRunningInRstestCi),
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
