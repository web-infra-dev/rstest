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
      syntax: 'es2023',
      dts: {
        isolated: true,
        bundle: false,
      },
      output: {
        externals: {
          // Keep @rstest/core as external
          '@rstest/core': '@rstest/core',
          '@rstest/core/internal/browser': '@rstest/core/internal/browser',
          // Keep @rsbuild/core as external (provided by @rstest/core)
          '@rsbuild/core': '@rsbuild/core',
        },
      },
      source: {
        tsconfigPath: './tsconfig.json',
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
                    ignore: ['**/*.LICENSE.txt', '**/rsdoctor-data.json'],
                  },
                  info: { minimized: true },
                },
              ],
            }),
            rsdoctorCIPlugin(),
          ].filter(Boolean),
        },
      },
    },
    {
      id: 'rstest-browser-client',
      syntax: 'es2023',
      dts: {
        isolated: true,
        bundle: false,
      },
      output: {
        target: 'web',
        distPath: 'dist/client',
        // Resolved by each browser project's Rsbuild alias.
        externals: ['__rstest_virtual_browser_manifest__'],
      },
      source: {
        tsconfigPath: './tsconfig.json',
        entry: {
          index: './src/client/index.ts',
          runner: './src/client/runner.ts',
        },
      },
      tools: {
        rspack: {
          plugins: [rsdoctorCIPlugin({ reportDir: '.rsdoctor/client' })].filter(
            Boolean,
          ),
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
