import fs from 'node:fs';
import {
  type ManifestData,
  type RsbuildInstance,
  logger as RsbuildLogger,
  type RsbuildPlugin,
  type Rspack,
  createRsbuild,
  rspack,
} from '@rsbuild/core';
import path from 'pathe';
import type { EntryInfo, RstestContext, SourceMapInput } from '../types';
import { TEMP_RSTEST_OUTPUT_DIR, getNodeVersion, isDebug } from '../utils';
import { pluginEntryWatch } from './plugins/entry';
import { pluginIgnoreResolveError } from './plugins/ignoreResolveError';

const isMultiCompiler = <
  C extends Rspack.Compiler = Rspack.Compiler,
  M extends Rspack.MultiCompiler = Rspack.MultiCompiler,
>(
  compiler: C | M,
): compiler is M => {
  return 'compilers' in compiler && Array.isArray(compiler.compilers);
};

const autoExternalNodeModules: (
  data: Rspack.ExternalItemFunctionData,
  callback: (
    err?: Error,
    result?: Rspack.ExternalItemValue,
    type?: Rspack.ExternalsType,
  ) => void,
) => void = ({ context, request, dependencyType, getResolve }, callback) => {
  if (!request || request.startsWith('node:')) {
    return callback();
  }

  if (request.startsWith('@swc/helpers/')) {
    // @swc/helper is a special case (Load by require but resolve to esm)
    return callback();
  }

  const doExternal = (externalPath: string = request) => {
    callback(
      undefined,
      externalPath,
      dependencyType === 'commonjs' ? 'commonjs' : 'module-import',
    );
  };

  const resolver = getResolve?.();

  if (!resolver) {
    return callback();
  }

  resolver(context!, request, (err, resolvePath) => {
    if (err) {
      // ignore resolve error
      return callback();
    }

    if (resolvePath && /node_modules/.test(resolvePath)) {
      return doExternal(resolvePath);
    }
    return callback();
  });
};

export const prepareRsbuild = async (
  context: RstestContext,
  globTestSourceEntries: () => Promise<Record<string, string>>,
  setupFiles: Record<string, string>,
): Promise<RsbuildInstance> => {
  const {
    command,
    normalizedConfig: {
      name,
      plugins,
      resolve,
      source,
      output,
      tools,
      testEnvironment,
    },
  } = context;

  RsbuildLogger.level = isDebug() ? 'verbose' : 'error';
  // TODO: find a better way to test outputs
  const writeToDisk = process.env.DEBUG_RSTEST_OUTPUTS === 'true';

  const rsbuildInstance = await createRsbuild({
    rsbuildConfig: {
      tools,
      plugins,
      resolve,
      source,
      output,
      server: {
        printUrls: false,
        strictPort: false,
        middlewareMode: true,
      },
      environments: {
        [name]: {
          dev: {
            writeToDisk,
          },
          source: {
            define: {
              'import.meta.rstest': "global['@rstest/core']",
            },
          },
          output: {
            // Pass resources to the worker on demand according to entry
            manifest: true,
            sourceMap: {
              js: 'source-map',
            },
            distPath: {
              root: TEMP_RSTEST_OUTPUT_DIR,
            },
            externals: [
              {
                '@rstest/core': 'global @rstest/core',
              },
              testEnvironment === 'node' ? autoExternalNodeModules : {},
            ],
            target: 'node',
          },
          tools: {
            rspack: (config) => {
              config.output ??= {};
              config.output.iife = false;
              config.externalsPresets = { node: true };
              config.output.devtoolModuleFilenameTemplate =
                '[absolute-resource-path]';
              config.plugins.push(
                new rspack.RstestPlugin({
                  injectModulePathName: true,
                }),
              );

              config.module.parser ??= {};
              config.module.parser.javascript = {
                // Keep dynamic import expressions.
                // eg. (modulePath) => import(modulePath)
                importDynamic: false,
                // Keep dynamic require expressions.
                // eg. (modulePath) => require(modulePath)
                requireDynamic: false,
                requireAsExpression: false,
                ...(config.module.parser.javascript || {}),
              };

              if (
                testEnvironment === 'node' &&
                (getNodeVersion()[0] || 0) < 20
              ) {
                config.resolve ??= {};
                // skip `module` field in Node.js 18 and below.
                // ESM module resolved by module field is not always a native ESM module
                config.resolve.mainFields = config.resolve.mainFields?.filter(
                  (filed) => filed !== 'module',
                ) || ['main'];
              }

              config.optimization = {
                ...(config.optimization || {}),
                moduleIds: 'named',
                chunkIds: 'named',
                splitChunks: {
                  chunks: 'all',
                  minSize: 0,
                  maxInitialRequests: Number.POSITIVE_INFINITY,
                },
              };
            },
          },
          plugins: [
            pluginIgnoreResolveError,
            pluginEntryWatch({
              globTestSourceEntries,
              setupFiles,
              isWatch: command === 'watch',
            }),
          ],
        },
      },
    },
  });

  return rsbuildInstance;
};

export const createRsbuildServer = async ({
  name,
  globTestSourceEntries,
  setupFiles,
  rsbuildInstance,
}: {
  rsbuildInstance: RsbuildInstance;
  name: string;
  globTestSourceEntries: () => Promise<Record<string, string>>;
  setupFiles: Record<string, string>;
  rootPath: string;
}): Promise<
  () => Promise<{
    buildTime: number;
    entries: EntryInfo[];
    setupEntries: EntryInfo[];
    assetFiles: Record<string, string>;
    sourceMaps: Record<string, SourceMapInput>;
    getSourcemap: (sourcePath: string) => SourceMapInput | null;
    close: () => Promise<void>;
  }>
> => {
  // Read files from memory via `rspackCompiler.outputFileSystem`
  let rspackCompiler: Rspack.Compiler | Rspack.MultiCompiler;

  const rstestCompilerPlugin: RsbuildPlugin = {
    name: 'rstest:compiler',
    setup: (api) => {
      api.onAfterCreateCompiler(({ compiler }) => {
        // outputFileSystem to be updated later by `rsbuild-dev-middleware`
        rspackCompiler = compiler;
      });
    },
  };

  rsbuildInstance.addPlugins([rstestCompilerPlugin]);

  const devServer = await rsbuildInstance.createDevServer({
    getPortSilently: true,
  });

  if (isDebug()) {
    await rsbuildInstance.inspectConfig({ writeToDisk: true });
  }

  const outputFileSystem =
    (isMultiCompiler(rspackCompiler!)
      ? rspackCompiler.compilers[0]!.outputFileSystem
      : rspackCompiler!.outputFileSystem) || fs;

  const getRsbuildStats = async () => {
    const stats = await devServer.environments[name]!.getStats();

    const manifest = devServer.environments[name]!.context
      .manifest as ManifestData;

    const {
      entrypoints,
      outputPath,
      assets,
      time: buildTime,
    } = stats.toJson({
      all: false,
      entrypoints: true,
      outputPath: true,
      assets: true,
      relatedAssets: true,
      cachedAssets: true,
      // get the compilation time
      timings: true,
    });

    const readFile = async (fileName: string) => {
      return new Promise<string>((resolve, reject) => {
        outputFileSystem.readFile(fileName, (err, data) => {
          if (err) {
            reject(err);
          }
          resolve(typeof data === 'string' ? data : data!.toString());
        });
      });
    };

    const getEntryFiles = async () => {
      const entryFiles: Record<string, string[]> = {};

      const entries = Object.keys(manifest!.entries!);

      for (const entry of entries) {
        const data = manifest!.entries[entry];
        entryFiles[entry] = (
          (data?.initial?.js || []).concat(data?.async?.js || []) || []
        ).map((file: string) => path.join(outputPath!, file));
      }
      return entryFiles;
    };

    const entryFiles = await getEntryFiles();
    const entries: EntryInfo[] = [];
    const setupEntries: EntryInfo[] = [];
    const sourceEntries = await globTestSourceEntries();
    // TODO: check compile error, such as setupFiles not found
    for (const entry of Object.keys(entrypoints!)) {
      const e = entrypoints![entry]!;

      const distPath = path.join(
        outputPath!,
        e.assets![e.assets!.length - 1]!.name,
      );

      if (setupFiles[entry]) {
        setupEntries.push({
          distPath,
          testPath: setupFiles[entry],
          files: entryFiles[entry],
        });
      } else if (sourceEntries[entry]) {
        entries.push({
          distPath,
          testPath: sourceEntries[entry],
          files: entryFiles[entry],
        });
      }
    }

    const sourceMaps: Record<string, SourceMapInput> = Object.fromEntries(
      (
        await Promise.all(
          assets!.map(async (asset) => {
            const sourceMapPath = asset?.info.related?.sourceMap?.[0];

            const assetFilePath = path.join(outputPath!, asset.name);
            if (sourceMapPath) {
              const filePath = path.join(outputPath!, sourceMapPath);
              const sourceMap = await readFile(filePath);
              return [assetFilePath, JSON.parse(sourceMap)];
            }
            return [assetFilePath, null];
          }),
        )
      ).filter((asset) => asset[1] !== null),
    );

    return {
      entries,
      setupEntries,
      buildTime: buildTime!,
      // Resources need to be obtained synchronously when the test is loaded, so files need to be read in advance
      assetFiles: Object.fromEntries(
        await Promise.all(
          assets!.map(async (a) => {
            const filePath = path.join(outputPath!, a.name);
            return [filePath, await readFile(filePath)];
          }),
        ),
      ),
      sourceMaps,
      getSourcemap: (sourcePath: string): SourceMapInput | null => {
        return sourceMaps[sourcePath] || null;
      },
      close: devServer.close,
    };
  };

  return getRsbuildStats;
};
