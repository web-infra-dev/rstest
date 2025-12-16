import { fileURLToPath } from 'node:url';
import {
  createRsbuild,
  type ManifestData,
  type RsbuildInstance,
  logger as RsbuildLogger,
  type RsbuildPlugin,
  type Rspack,
} from '@rsbuild/core';
import path from 'pathe';
import type {
  EntryInfo,
  NormalizedProjectConfig,
  RstestContext,
} from '../types';
import { isDebug } from '../utils';
import { isMemorySufficient } from '../utils/memory';
import { pluginBasic, RUNTIME_CHUNK_NAME } from './plugins/basic';
import { pluginCSSFilter } from './plugins/css-filter';
import { pluginEntryWatch } from './plugins/entry';
import { pluginExternal } from './plugins/external';
import { pluginIgnoreResolveError } from './plugins/ignoreResolveError';
import { pluginInspect } from './plugins/inspect';
import { pluginMockRuntime } from './plugins/mockRuntime';
import { pluginCacheControl } from './plugins/moduleCacheControl';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type TestEntryToChunkHashes = {
  name: string;
  /** key is chunk name, value is chunk hash */
  chunks: Record<string, string>;
}[];

function parseInlineSourceMapStr(code: string) {
  // match the inline source map comment (format may be `//# sourceMappingURL=data:...`)
  const inlineSourceMapRegex =
    /\/\/# sourceMappingURL=data:application\/json(?:;charset=utf-8)?;base64,(.+)\s*$/m;
  const match = code.match(inlineSourceMapRegex);

  if (!match || !match[1]) {
    return null;
  }

  try {
    const base64Data = match[1];
    const decodedStr = Buffer.from(base64Data, 'base64').toString('utf-8');
    return decodedStr;
  } catch (_error) {
    return null;
  }
}

const isMultiCompiler = <
  C extends Rspack.Compiler = Rspack.Compiler,
  M extends Rspack.MultiCompiler = Rspack.MultiCompiler,
>(
  compiler: C | M,
): compiler is M => {
  return 'compilers' in compiler && Array.isArray(compiler.compilers);
};

export const prepareRsbuild = async (
  context: RstestContext,
  globTestSourceEntries: (name: string) => Promise<Record<string, string>>,
  setupFiles: Record<string, Record<string, string>>,
  globalSetupFiles: Record<string, Record<string, string>>,
): Promise<RsbuildInstance> => {
  const {
    command,
    normalizedConfig: { isolate, dev = {}, coverage },
  } = context;
  const debugMode = isDebug();

  RsbuildLogger.level = debugMode ? 'verbose' : 'error';
  const writeToDisk = dev.writeToDisk || debugMode;

  const rsbuildInstance = await createRsbuild({
    callerName: 'rstest',
    config: {
      root: context.rootPath,
      server: {
        printUrls: false,
        strictPort: false,
        middlewareMode: true,
        compress: false,
        cors: false,
        publicDir: false,
      },
      dev: {
        hmr: false,
        writeToDisk,
      },
      environments: Object.fromEntries(
        context.projects.map((project) => [
          project.environmentName,
          {
            plugins: project.normalizedConfig.plugins,
            root: project.rootPath,
            output: {
              target: 'node',
            },
          },
        ]),
      ),
      plugins: [
        pluginBasic(context),
        pluginIgnoreResolveError,
        pluginMockRuntime,
        pluginCSSFilter(),
        pluginEntryWatch({
          globTestSourceEntries,
          setupFiles,
          globalSetupFiles,
          context,
          isWatch: command === 'watch',
        }),
        pluginExternal(context),
        !isolate
          ? pluginCacheControl(
              Object.values({
                ...setupFiles,
                ...globalSetupFiles,
              }).flatMap((files) => Object.values(files)),
            )
          : null,
        pluginInspect(),
      ].filter(Boolean) as RsbuildPlugin[],
    },
  });

  if (coverage?.enabled && command !== 'list') {
    const { loadCoverageProvider } = await import('../coverage');
    const { pluginCoverageCore } = await import('../coverage/plugin');
    const { pluginCoverage } = await loadCoverageProvider(
      coverage,
      context.rootPath,
    );
    coverage.exclude.push(
      ...Object.values(setupFiles).flatMap((files) => Object.values(files)),
      ...Object.values(globalSetupFiles || {}).flatMap((files) =>
        Object.values(files),
      ),
    );

    rsbuildInstance.addPlugins([
      pluginCoverage(coverage),
      pluginCoverageCore(coverage),
    ]);
  }

  return rsbuildInstance;
};

export const calcEntriesToRerun = (
  entries: EntryInfo[],
  chunks: Rspack.StatsChunk[] | undefined,
  buildData: { entryToChunkHashes?: TestEntryToChunkHashes },
  runtimeChunkName: string,
): {
  affectedEntries: EntryInfo[];
  deletedEntries: string[];
} => {
  const entryToChunkHashesMap = new Map<string, Record<string, string>>();

  // Build current chunk hashes map
  const buildChunkHashes = (entry: EntryInfo) => {
    const validChunks = (entry.chunks || []).filter(
      (chunk) => chunk !== runtimeChunkName,
    );

    validChunks.forEach((chunkName) => {
      const chunkInfo = chunks?.find((c) =>
        c.names?.includes(chunkName as string),
      );
      if (chunkInfo) {
        const existing = entryToChunkHashesMap.get(entry.testPath) || {};
        existing[chunkName] = chunkInfo.hash ?? '';
        entryToChunkHashesMap.set(entry.testPath, existing);
      }
    });
  };

  (entries || []).forEach(buildChunkHashes);

  const entryToChunkHashes: TestEntryToChunkHashes = Array.from(
    entryToChunkHashesMap.entries(),
  ).map(([name, chunks]) => ({ name, chunks }));

  // Process changes if we have previous data
  const affectedTestPaths = new Set<string>();
  const deletedEntries: string[] = [];

  if (buildData.entryToChunkHashes) {
    const prevMap = new Map(
      buildData.entryToChunkHashes.map((e) => [e.name, e.chunks]),
    );
    const currentNames = new Set(entryToChunkHashesMap.keys());

    // Find deleted entries
    deletedEntries.push(
      ...Array.from(prevMap.keys()).filter((name) => !currentNames.has(name)),
    );

    // Find modified or added entries
    const findAffectedEntry = (testPath: string) => {
      const currentChunks = entryToChunkHashesMap.get(testPath);
      const prevChunks = prevMap.get(testPath);

      if (!currentChunks) return;

      if (!prevChunks) {
        // New entry
        affectedTestPaths.add(testPath);
        return;
      }

      // Check for modified chunks
      const hasChanges = Object.entries(currentChunks).some(
        ([chunkName, hash]) => prevChunks[chunkName] !== hash,
      );

      if (hasChanges) {
        affectedTestPaths.add(testPath);
      }
    };

    entryToChunkHashesMap.forEach((_, testPath) => {
      findAffectedEntry(testPath);
    });
  }

  buildData.entryToChunkHashes = entryToChunkHashes;

  // Convert affected test paths to EntryInfo objects
  const affectedEntries = Array.from(affectedTestPaths)
    .map((testPath) => entries.find((e) => e.testPath === testPath))
    .filter((entry): entry is EntryInfo => entry !== undefined);

  return { affectedEntries, deletedEntries };
};

class AssetsMemorySafeMap extends Map<string, string> {
  override set(key: string, value: string): this {
    if (this.has(key)) {
      return this;
    }
    if (!isMemorySufficient()) {
      this.clear();
    }

    return super.set(key, value);
  }
}

export const createRsbuildServer = async ({
  globTestSourceEntries,
  setupFiles,
  globalSetupFiles,
  rsbuildInstance,
  inspectedConfig,
}: {
  rsbuildInstance: RsbuildInstance;
  inspectedConfig: RstestContext['normalizedConfig'] & {
    projects: NormalizedProjectConfig[];
  };
  globTestSourceEntries: (name: string) => Promise<Record<string, string>>;
  setupFiles: Record<string, Record<string, string>>;
  globalSetupFiles: Record<string, Record<string, string>>;
  rootPath: string;
}): Promise<{
  getRsbuildStats: (options: {
    environmentName: string;
    fileFilters?: string[];
  }) => Promise<{
    hash?: string;
    entries: EntryInfo[];
    setupEntries: EntryInfo[];
    globalSetupEntries: EntryInfo[];
    assetNames: string[];
    getAssetFiles: (names: string[]) => Promise<Record<string, string>>;
    getSourceMaps: (names: string[]) => Promise<Record<string, string>>;
    affectedEntries: EntryInfo[];
    deletedEntries: string[];
  }>;
  closeServer: () => Promise<void>;
}> => {
  // Read files from memory via `rspackCompiler.outputFileSystem`
  let rspackCompiler: Rspack.Compiler | Rspack.MultiCompiler | undefined;

  const rstestCompilerPlugin: RsbuildPlugin = {
    name: 'rstest:compiler',
    setup: (api) => {
      api.modifyBundlerChain((chain) => {
        // add mock-loader to this rule
        chain.module
          .rule('rstest-mock-module-doppelgangers')
          .test(/\.(?:js|jsx|mjs|cjs|ts|tsx|mts|cts)$/)
          .with({ rstest: 'importActual' })
          .use('import-actual-loader')
          .loader(path.resolve(__dirname, './importActualLoader.mjs'))
          .end();
      });

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
    await rsbuildInstance.inspectConfig({
      writeToDisk: true,
      extraConfigs: {
        rstest: inspectedConfig,
      },
    });
  }

  if (!rspackCompiler) {
    throw new Error('rspackCompiler was not initialized');
  }

  const outputFileSystem: Rspack.OutputFileSystem | null = isMultiCompiler(
    rspackCompiler,
  )
    ? rspackCompiler.compilers[0]!.outputFileSystem
    : rspackCompiler.outputFileSystem;

  if (!outputFileSystem) {
    throw new Error(
      `Expect outputFileSystem to be defined, but got ${outputFileSystem}`,
    );
  }

  const readFile = async (fileName: string) => {
    return new Promise<string>((resolve, reject) => {
      outputFileSystem.readFile(fileName, (err, data) => {
        if (err) {
          reject(err);
        }
        const content =
          typeof data === 'string'
            ? data
            : fileName.endsWith('.wasm')
              ? data!.toString('base64')
              : data!.toString('utf-8');

        resolve(content);
      });
    });
  };

  const buildData: Record<
    string,
    { entryToChunkHashes?: TestEntryToChunkHashes }
  > = {};

  const getEntryFiles = async (manifest: ManifestData, outputPath: string) => {
    const entryFiles: Record<string, string[]> = {};

    const entries = Object.keys(manifest.entries);

    for (const entry of entries) {
      const data = manifest.entries[entry];
      entryFiles[entry] = (
        (data?.initial?.js || []).concat(data?.async?.js || []) || []
      ).map((file: string) => path.join(outputPath, file));
    }
    return entryFiles;
  };

  const getRsbuildStats = async ({
    environmentName,
    fileFilters,
  }: {
    environmentName: string;
    fileFilters?: string[];
  }) => {
    const stats = await devServer.environments[environmentName]!.getStats();

    const enableAssetsCache = isMemorySufficient();

    const manifest = devServer.environments[environmentName]!.context
      .manifest as ManifestData;

    const { entrypoints, outputPath, assets, hash, chunks } = stats.toJson({
      all: false,
      hash: true,
      entrypoints: true,
      outputPath: true,
      assets: true,
      relatedAssets: true,
      cachedAssets: true,
      // get the compilation time
      chunks: true,
      timings: true,
    });

    const entryFiles = await getEntryFiles(manifest, outputPath!);
    const entries: EntryInfo[] = [];
    const setupEntries: EntryInfo[] = [];
    const globalSetupEntries: EntryInfo[] = [];
    const sourceEntries = await globTestSourceEntries(environmentName);

    for (const entry of Object.keys(entrypoints!)) {
      const e = entrypoints![entry]!;
      const filteredAssets = e.assets!.filter(
        (asset) => !asset.name.endsWith('.wasm'),
      );

      const distPath = path.join(
        outputPath!,
        filteredAssets[filteredAssets.length - 1]!.name,
      );

      if (setupFiles[environmentName]?.[entry]) {
        setupEntries.push({
          distPath,
          testPath: setupFiles[environmentName][entry],
          files: entryFiles[entry],
          chunks: e.chunks || [],
        });
      } else if (sourceEntries[entry]) {
        if (
          fileFilters?.length &&
          !fileFilters.includes(sourceEntries[entry])
        ) {
          continue;
        }
        entries.push({
          distPath,
          testPath: sourceEntries[entry],
          files: entryFiles[entry],
          chunks: e.chunks || [],
        });
      } else if (globalSetupFiles?.[environmentName]?.[entry]) {
        globalSetupEntries.push({
          distPath,
          testPath: globalSetupFiles[environmentName][entry],
          files: entryFiles[entry],
          chunks: e.chunks || [],
        });
      }
    }

    const inlineSourceMap =
      stats.compilation.options.devtool === 'inline-source-map';

    const sourceMapPaths: Record<string, string | null> = Object.fromEntries(
      assets!.map((asset) => {
        const assetFilePath = path.join(outputPath!, asset.name);

        if (inlineSourceMap) {
          return [assetFilePath, assetFilePath];
        }
        const sourceMapPath = asset?.info.related?.sourceMap?.[0];

        if (sourceMapPath) {
          const filePath = path.join(outputPath!, sourceMapPath);
          return [assetFilePath, filePath];
        }
        return [assetFilePath, null];
      }),
    );

    buildData[environmentName] ??= {};

    // affectedEntries: entries affected by source code.
    // deletedEntries: entry files deleted from compilation.
    const { affectedEntries, deletedEntries } = calcEntriesToRerun(
      entries,
      chunks,
      buildData[environmentName],
      `${environmentName}-${RUNTIME_CHUNK_NAME}`,
    );

    const cachedAssetFiles = new AssetsMemorySafeMap();
    const cachedSourceMaps = new AssetsMemorySafeMap();

    const readFileWithCache = async (name: string) => {
      if (enableAssetsCache && cachedAssetFiles.has(name)) {
        return cachedAssetFiles.get(name)!;
      }
      const content = await readFile(name);

      enableAssetsCache && cachedAssetFiles.set(name, content);

      return content;
    };

    const getSourceMap = async (name: string): Promise<null | string> => {
      const sourceMapPath = sourceMapPaths[name];
      if (!sourceMapPath) {
        return null;
      }

      if (enableAssetsCache && cachedSourceMaps.has(name)) {
        return cachedSourceMaps.get(name)!;
      }

      let content = null;

      if (inlineSourceMap) {
        const file = await readFile(sourceMapPath);
        content = parseInlineSourceMapStr(file);
      } else {
        const sourceMap = await readFile(sourceMapPath);
        content = sourceMap;
      }

      enableAssetsCache && content && cachedSourceMaps.set(name, content);

      return content;
    };

    const assetNames = assets!.map((asset) =>
      path.join(outputPath!, asset.name),
    );

    return {
      affectedEntries,
      deletedEntries,
      hash,
      entries,
      setupEntries,
      globalSetupEntries,
      assetNames,
      getAssetFiles: async (names: string[]) => {
        return Object.fromEntries(
          await Promise.all(
            names.map(async (name) => {
              const content = await readFileWithCache(name);
              return [name, content];
            }),
          ),
        );
      },
      getSourceMaps: async (names: string[]) => {
        return Object.fromEntries(
          await Promise.all(
            names.map(async (name) => {
              const content = await getSourceMap(name);
              return [name, content];
            }),
          ),
        );
      },
    };
  };

  return {
    closeServer: devServer.close,
    getRsbuildStats,
  };
};
