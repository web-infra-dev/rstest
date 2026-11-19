import { createRequire } from 'node:module';
import { pluginNodePolyfill } from '@rsbuild/plugin-node-polyfill';
import { define } from 'rstack';
import { rspack, type Rsbuild } from 'rstack/lib';
import { publishCheckPlugins } from '../../scripts/publishCheckPlugins.ts';
import { rslibRspackConfig } from '../../scripts/rslibConfig.ts';
import { rsdoctorCIPlugin } from '../../scripts/rsdoctorPlugin.ts';
import browserPackage from '../browser/package.json' with { type: 'json' };
import { licensePlugin, writeCollectedLicenseFile } from './licensePlugin.ts';
import packageJson from './package.json' with { type: 'json' };

const { peerDependencies, version: browserVersion } = browserPackage;
const { version } = packageJson;

const require = createRequire(import.meta.url);

// `RSTEST_VERSION` is build-injected into both @rstest/core and @rstest/browser
// from each package's own package.json, and the browser-mode runtime gate
// (core/src/core/browser/loader.ts) refuses to load a browser build whose version
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
const enableSourceMap = process.env.SOURCEMAP === 'true';

// Deduplicate bare and `node:` builtin imports across all Node libs.
const nodeExternals = {
  fs: 'node:fs',
  os: 'node:os',
  tty: 'node:tty',
  util: 'node:util',
  path: 'node:path',
};

const readableMinifyConfig = {
  jsOptions: {
    minimizerOptions: {
      mangle: false,
      minify: false,
      compress: {
        defaults: false,
        unused: true,
        dead_code: true,
        toplevel: true,
        // Inline snapshots locate their call site through this function name.
        keep_fnames: true,
      },
      format: {
        comments: 'some',
        preserve_annotations: true,
      },
    },
  },
} satisfies Rsbuild.Minify;

const createSplitMinify = (fullyMinified: RegExp): Rsbuild.Minify => ({
  jsOptions: [
    { include: fullyMinified },
    { ...readableMinifyConfig.jsOptions, exclude: fullyMinified },
  ],
});

// `minify` is scoped per lib, so `~\d+` matches rslib's multi-compiler suffix
// regardless of lib ordering in `define.lib({ lib })`.
const fullyMinifiedNodeChunks =
  /(?:^|\/)(?:@clack\/prompts|@vitest\/pretty-format|chokidar|diff|fake-timers|magic-string\.es)~\d+\.js$/;
const fullyMinifiedBrowserChunks =
  /(?:^|\/)(?:browser-runtime-vendor|fake-timers|magic-string\.es)~\d+\.js$/;
const fullyMinifiedWorkerChunks =
  /(?:^|\/)(?:@vitest\/pretty-format|diff|magic-string\.es)~\d+\.js$/;

// Disable chunk splitting for worker libs so startup loads one chunk instead
// of walking a chunk graph.
const singleChunkOptimization = {
  splitChunks: false,
  runtimeChunk: false,
} as const;

const shouldEmitLicense = !isBuildWatch && isLibBuild;
const licenseRenderOptions = {
  packageName: '@rstest/core',
  includeCodeReferences: true,
};
// One instance per lib (the plugin keeps per-compilation state); skipped in
// watch mode to avoid `ResourceData has been dropped by Rust`.
const createLibLicensePlugin = () =>
  licensePlugin(
    licenseRenderOptions.packageName,
    licenseRenderOptions.includeCodeReferences,
  );
const licensePlugins = shouldEmitLicense
  ? {
      rstest: await createLibLicensePlugin(),
      worker: await createLibLicensePlugin(),
      workerLazyDeps: await createLibLicensePlugin(),
    }
  : {};

/**
 * Writes `LICENSE.md` once for all libs: each lib reports only the packages in
 * its own compilation, and they compile in parallel.
 */
const emitMergedLicense: Rsbuild.RsbuildPlugin = {
  name: 'rstest:merge-license',
  setup(api) {
    api.onAfterBuild(async ({ stats }) => {
      // A failed compilation reports only part of its graph; writing then
      // would overwrite the tracked file with a package subset.
      if (!shouldEmitLicense || stats?.hasErrors()) {
        return;
      }
      await writeCollectedLicenseFile(
        new URL('./LICENSE.md', import.meta.url),
        licenseRenderOptions,
      );
    });
  },
};

/**
 * Picks worker-only loader variants for modules shared with `browser_runtime`
 * (where they stay lazy chunks). Keys match the exact relative requests inside
 * the `worker` lib.
 */
const workerRuntimeAliases = {
  './fakeTimersLoader':
    require.resolve('./src/runtime/api/fakeTimersLoader.node.ts'),
  './snapshotLoader':
    require.resolve('./src/runtime/api/snapshotLoader.worker.ts'),
};

// An allowlist preserves the existing lazy snapshot, fake-timers, and
// magic-string chunk boundaries.
const browserRuntimeVendorModules =
  /[\\/]node_modules[\\/](?:@vitest[\\/](?:expect|pretty-format|spy|utils)|base64-js|buffer|chai|ieee754|pathe|path-browserify|process|stacktrace-parser|tinyrainbow|tinyspy|url-extras)(?:[\\/]|$)/;

// API Extractor keeps this reference from bundled @vitest/expect but omits
// the matching global augmentation that makes the declaration self-contained.
const jestMatchersDtsBanner = `declare global {
  namespace jest {
    interface Matchers<R, T = {}> {}
  }
}`;

define.lib({
  plugins: [...publishCheckPlugins(), emitMergedLicense],
  lib: [
    {
      id: 'rstest',
      syntax: 'es2023',
      dts: {
        isolated: true,
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
      banner: {
        dts: jestMatchersDtsBanner,
      },
      output: {
        sourceMap: enableSourceMap,
        externals: nodeExternals,
        minify: createSplitMinify(fullyMinifiedNodeChunks),
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
          adapter: './src/adapter.ts',
          browser: './src/browser.ts',
          globalSetupWorker: './src/runtime/worker/globalSetupWorker.ts',
          prebundleWorker: './src/core/environment/prebundleWorker.ts',
        },
      },
      tools: {
        rspack: {
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
                {
                  from: 'src/core/plugins/wasmLoader.mjs',
                  to: 'wasmLoader.mjs',
                },
                {
                  from: 'src/core/plugins/styleFallbackLoader.mjs',
                  to: 'styleFallbackLoader.mjs',
                },
              ],
            }),
            licensePlugins.rstest,
            rsdoctorCIPlugin({ reportDir: '.rsdoctor/main' }),
          ].filter(Boolean),
        },
      },
    },
    {
      id: 'browser_runtime',
      syntax: 'es2023',
      dts: {
        isolated: true,
        bundle: {
          bundledPackages: ['@vitest/spy', 'tinyrainbow'],
        },
      },
      banner: {
        dts: jestMatchersDtsBanner,
      },
      source: {
        entry: {
          index: './src/browserRuntime.ts',
        },
      },
      output: {
        target: 'web',
        distPath: 'dist/browser-runtime',
        sourceMap: enableSourceMap,
        minify: createSplitMinify(fullyMinifiedBrowserChunks),
      },
      plugins: [pluginNodePolyfill()],
      tools: {
        rspack: {
          optimization: {
            // Split chunks register through the Rspack runtime. Leaving it in
            // the entry chunk creates a circular ESM initialization dependency.
            runtimeChunk: {
              name: 'browser-runtime-runtime',
            },
            splitChunks: {
              cacheGroups: {
                browserRuntimeVendor: {
                  chunks: 'initial',
                  enforce: true,
                  name: 'browser-runtime-vendor',
                  test: browserRuntimeVendorModules,
                },
              },
            },
          },
          plugins: [
            rsdoctorCIPlugin({ reportDir: '.rsdoctor/browser' }),
          ].filter(Boolean),
        },
      },
    },
    {
      id: 'worker',
      syntax: 'es2023',
      dts: false,
      output: {
        // Shares `dist` with the other Node libs; only the first lib cleans it.
        cleanDistPath: false,
        sourceMap: enableSourceMap,
        externals: nodeExternals,
        minify: createSplitMinify(fullyMinifiedWorkerChunks),
      },
      shims: {
        esm: {
          require: true,
        },
      },
      source: {
        entry: {
          worker: './src/runtime/worker/index.ts',
        },
        define: {
          // Worker-only code paths; read behind a `typeof` guard so running
          // from `src/` (unit tests) does not throw.
          __RSTEST_WORKER_BUILD__: JSON.stringify(true),
        },
      },
      tools: {
        rspack: (config, { mergeConfig }) => {
          return mergeConfig(config, {
            optimization: singleChunkOptimization,
            resolve: {
              alias: workerRuntimeAliases,
            },
            plugins: [
              licensePlugins.worker,
              rsdoctorCIPlugin({ reportDir: '.rsdoctor/worker' }),
            ].filter(Boolean),
          });
        },
      },
    },
    {
      id: 'worker_lazy_deps',
      format: 'cjs',
      syntax: 'es2023',
      dts: false,
      output: {
        cleanDistPath: false,
        sourceMap: enableSourceMap,
        externals: nodeExternals,
        // Pure third-party code, loaded on demand by the worker.
        minify: {
          jsOptions: [{ include: /\.cjs$/ }],
        },
      },
      source: {
        entry: {
          'worker-fake-timers': './src/runtime/api/fakeTimers.ts',
          'worker-source-map-support':
            './src/runtime/worker/sourceMapSupport.ts',
        },
      },
      tools: {
        rspack: (config, { mergeConfig }) => {
          return mergeConfig(config, {
            optimization: singleChunkOptimization,
            plugins: [
              licensePlugins.workerLazyDeps,
              rsdoctorCIPlugin({ reportDir: '.rsdoctor/worker-lazy-deps' }),
            ].filter(Boolean),
          });
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
      ...rslibRspackConfig,
      resolve: {
        alias: {
          // Share @vitest/utils' instance so applyRuntimeColors governs diff and expect colors.
          tinyrainbow: createRequire(
            require.resolve('@vitest/utils/diff'),
          ).resolve('tinyrainbow'),
        },
      },
      module: {
        ...rslibRspackConfig.module,
        rules: [
          {
            // `fakeTimers.ts` loads `@sinonjs/fake-timers` through
            // `createRequire(import.meta.url)`; let Rspack bundle that call so
            // the dependency stays in the chunk for the Node and browser targets.
            test: /[\\/]runtime[\\/]api[\\/]fakeTimers\.ts$/,
            parser: { createRequire: true },
          },
        ],
      },
      watchOptions: {
        ignored: /\.git/,
      },
    },
  },
});
