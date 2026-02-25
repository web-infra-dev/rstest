import { createRequire } from 'node:module';
import { defineConfig, rspack } from '@rslib/core';
import { dirname, resolve } from 'pathe';

const require = createRequire(import.meta.url);
const browserUiRoot = dirname(
  require.resolve('@rstest/browser-ui/package.json'),
);
const browserUiDist = resolve(browserUiRoot, 'dist');

export default defineConfig({
  lib: [
    {
      id: 'rstest-browser',
      format: 'esm',
      syntax: 'es2023',
      dts: {
        bundle: false,
      },
      output: {
        externals: {
          // Keep @rstest/core as external
          '@rstest/core': '@rstest/core',
          '@rstest/core/browser': '@rstest/core/browser',
          // Keep @rsbuild/core as external (provided by @rstest/core)
          '@rsbuild/core': '@rsbuild/core',
        },
      },
      source: {
        entry: {
          index: './src/index.ts',
        },
      },
      tools: {
        rspack: {
          plugins: [
            new rspack.CopyRspackPlugin({
              patterns: [
                {
                  from: browserUiDist,
                  to: 'browser-container',
                  context: browserUiDist,
                  globOptions: {
                    ignore: ['**/*.LICENSE.txt'],
                  },
                },
              ],
            }),
          ],
        },
      },
    },
  ],
  source: {
    define: {
      RSTEST_VERSION: JSON.stringify(require('./package.json').version),
    },
  },
});
