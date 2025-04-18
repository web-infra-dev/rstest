import { defineConfig } from '@rslib/core';

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
          public: './src/public.ts',
          node: './src/node.ts',
          cli: './src/cli/index.ts',
          worker: './src/runtime/worker/index.ts',
        },
        define: {
          RSTEST_VERSION: JSON.stringify(require('./package.json').version),
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
