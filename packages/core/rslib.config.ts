import { pluginNodePolyfill } from '@rsbuild/plugin-node-polyfill';
import { defineConfig, rspack } from '@rslib/core';
import { publishCheckPlugins } from '../../scripts/publishCheckPlugins';
import { rsdoctorCIPlugin } from '../../scripts/rsdoctorPlugin';
import {
  peerDependencies,
  version as browserVersion,
} from '../browser/package.json';
import { licensePlugin } from './licensePlugin';
import { version } from './package.json';

// `RSTEST_VERSION` is build-injected into both @rstest/core and @rstest/browser
// from each package's own package.json, and the browser-mode runtime gate
// (core/src/core/browserLoader.ts) refuses to load a browser build whose version
// differs from core's. Those two reads can only drift if the packages are
// versioned independently — which a single build cannot otherwise detect — so
// assert the peer pair is in lockstep here, surfacing a mismatch at build time
// instead of as a runtime version-gate false negative for the user.
if (version !== browserVersion) {
  throw new Error(
    `@rstest/core (${version}) and @rstest/browser (${browserVersion}) versions ` +
      'are out of sync. They are published as a peer pair and must match; ' +
      'bump packages/core/package.json and packages/browser/package.json together.',
  );
}

const isBuildWatch = process.argv.includes('--watch');
const isLibBuild = process.argv.includes('build');

export default defineConfig({
  plugins: publishCheckPlugins(),
  lib: [
    {
      id: 'rstest',
      format: 'esm',
      syntax: 'es2023',
      experiments: {
        advancedEsm: true,
      },
      dts: {
        tsgo: true,
        bundle: process.env.SOURCEMAP
          ? false
          : {
              bundledPackages: [
                '@sinonjs/fake-timers',
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
        sourceMap: process.env.SOURCEMAP === 'true',
        externals: {
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
          'api/index': './src/api/index.ts',
          browser: './src/browser.ts',
          worker: './src/runtime/worker/index.ts',
          globalSetupWorker: './src/runtime/worker/globalSetupWorker.ts',
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
                  from: 'src/pool/rstestSuppressWarnings.cjs',
                  to: 'rstestSuppressWarnings.cjs',
                },
                {
                  from: 'src/core/plugins/importActualLoader.mjs',
                  to: 'importActualLoader.mjs',
                },
              ],
            }),
            // only load & apply licensePlugin in lib build
            isBuildWatch || !isLibBuild ? null : await licensePlugin(),
            rsdoctorCIPlugin({ reportDir: '.rsdoctor/main' }),
          ].filter(Boolean),
        },
      },
    },
    {
      id: 'rstest_loaders',
      format: 'esm',
      syntax: 'es2023',
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
      tools: {
        rspack: {
          plugins: [
            rsdoctorCIPlugin({ reportDir: '.rsdoctor/loaders' }),
          ].filter(Boolean),
        },
      },
    },
    {
      id: 'browser_runtime',
      format: 'esm',
      syntax: 'es2023',
      dts: {
        tsgo: true,
        bundle: true,
      },
      source: {
        entry: {
          index: './src/browserRuntime.ts',
        },
      },
      output: {
        target: 'web',
        distPath: 'dist/browser-runtime',
        sourceMap: process.env.SOURCEMAP === 'true',
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
                // should keep function name __INLINE_SNAPSHOT__ used to filter stack trace
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
      plugins: [pluginNodePolyfill()],
      tools: {
        rspack: {
          plugins: [
            rsdoctorCIPlugin({ reportDir: '.rsdoctor/browser' }),
          ].filter(Boolean),
        },
      },
    },
  ],
  performance: {
    printFileSize: !isBuildWatch,
  },
  source: {
    define: {
      RSTEST_VERSION: JSON.stringify(version),
      PLAYWRIGHT_VERSION: JSON.stringify(peerDependencies.playwright),
    },
  },
  tools: {
    rspack: {
      watchOptions: {
        ignored: /\.git/,
      },
    },
  },
});
