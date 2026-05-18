import { createRequire } from 'node:module';
import { defineConfig, rspack } from '@rslib/core';
import { dirname, resolve } from 'pathe';
import { publishCheckPlugins } from '../../scripts/publishCheckPlugins';
import { rsdoctorCIPlugin } from '../../scripts/rsdoctorPlugin';

const require = createRequire(import.meta.url);
const browserUiRoot = dirname(
  require.resolve('@rstest/browser-ui/package.json'),
);
const browserUiDist = resolve(browserUiRoot, 'dist');

export default defineConfig({
  plugins: publishCheckPlugins(),
  lib: [
    {
      id: 'rstest-browser',
      format: 'esm',
      syntax: 'es2023',
      dts: {
        tsgo: true,
        bundle: false,
      },
      redirect: {
        // Append `.js` to relative imports in emitted .d.ts so they resolve
        // under NodeNext/Node16 module resolution (ESM requires explicit ext).
        dts: { extension: true },
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
        tsconfigPath: './tsconfig.json',
        entry: {
          index: './src/index.ts',
          browser: './src/browser.ts',
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
                    ignore: ['**/*.LICENSE.txt', '**/rsdoctor-data.json'],
                  },
                },
              ],
            }),
            rsdoctorCIPlugin(),
          ].filter(Boolean),
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
