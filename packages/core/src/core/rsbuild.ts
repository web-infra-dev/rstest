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
  ProjectContext,
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
  /** key is chunk asset file path, value is chunk hash */
  chunks: Record<string, string>;
}[];

const getRuntimeChunkFiles = ({
  chunks,
  outputPath,
  runtimeChunkName,
}: {
  chunks: Rspack.StatsChunk[] | undefined;
  outputPath: string;
  runtimeChunkName: string;
}): Set<string> => {
  const runtimeChunkFiles = new Set<string>();

  for (const chunk of chunks || []) {
    const isRuntimeChunk =
      chunk.id === runtimeChunkName || chunk.names?.includes(runtimeChunkName);

    if (!isRuntimeChunk) {
      continue;
    }

    for (const file of chunk.files || []) {
      runtimeChunkFiles.add(path.join(outputPath, String(file)));
    }
  }

  return runtimeChunkFiles;
};

function parseInlineSourceMapStr(code: string) {
  // match the inline source map comment (format may be `//# sourceMappingURL=data:...`)
  const inlineSourceMapRegex =
    /\/\/# sourceMappingURL=data:application\/json(?:;charset=utf-8)?;base64,(.+)\s*$/m;
  const match = inlineSourceMapRegex.exec(code);

  if (!match?.[1]) {
    return null;
  }

  try {
    const base64Data = match[1];
    const decodedStr = Buffer.from(base64Data, 'base64').toString('utf-8');
    return decodedStr;
  } catch {
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
  /**
   * Explicit list of node-mode projects to include in the Rsbuild instance.
   * When provided, only these projects will be compiled.
   */
  targetNodeProjects?: ProjectContext[],
): Promise<RsbuildInstance> => {
  const {
    command,
    normalizedConfig: { isolate, dev = {}, coverage, pool },
  } = context;

  // Filter out browser mode projects - this rsbuild is for node mode only
  const projects = targetNodeProjects?.length
    ? targetNodeProjects
    : context.projects.filter(
        (project) => !project.normalizedConfig.browser.enabled,
      );
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
        projects.map((project) => [
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
        pluginInspect({ poolExecArgv: pool.execArgv }),
      ].filter(Boolean) as RsbuildPlugin[],
    },
  });

  if (coverage?.enabled && command !== 'list') {
    const [{ loadCoverageProvider }, { pluginCoverageCore }] =
      await Promise.all([import('../coverage'), import('../coverage/plugin')]);
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

const calcEntriesToRerun = (
  entries: EntryInfo[],
  chunks: Rspack.StatsChunk[] | undefined,
  buildData: {
    entryToChunkHashes?: TestEntryToChunkHashes;
    setupEntryToChunkHashes?: TestEntryToChunkHashes;
    chunkHashesByFile?: Record<string, string>;
    runtimeChunkFiles?: string[];
  },
  outputPath: string,
  runtimeChunkName: string,
  setupEntries: EntryInfo[],
): {
  affectedEntries: EntryInfo[];
  deletedEntries: string[];
} => {
  const entryByTestPath = new Map(
    entries.map((entry) => [entry.testPath, entry] as const),
  );
  const chunkHashesByFile = new Map(
    Object.entries(buildData.chunkHashesByFile || {}),
  );
  const runtimeChunkFiles = new Set(buildData.runtimeChunkFiles || []);

  for (const chunk of chunks || []) {
    const isRuntimeChunk =
      chunk.id === runtimeChunkName || chunk.names?.includes(runtimeChunkName);

    for (const file of chunk.files || []) {
      const filePath = path.join(outputPath, String(file));
      chunkHashesByFile.set(filePath, chunk.hash ?? '');

      if (isRuntimeChunk) {
        runtimeChunkFiles.add(filePath);
      }
    }
  }

  const buildChunkHashes = (
    entry: EntryInfo,
    map: Map<string, Record<string, string>>,
  ) => {
    const chunkHashes = Object.fromEntries(
      (entry.files || [])
        .filter((file) => !runtimeChunkFiles.has(file))
        .map((file) => [file, chunkHashesByFile.get(file) ?? '']),
    );

    map.set(entry.testPath, chunkHashes);
  };

  const processEntryChanges = (
    prevHashes: TestEntryToChunkHashes | undefined,
    currentHashesMap: Map<string, Record<string, string>>,
  ): {
    affectedPaths: Set<string>;
    deletedPaths: string[];
  } => {
    const affectedPaths = new Set<string>();
    const deletedPaths: string[] = [];

    if (prevHashes) {
      const prevMap = new Map(prevHashes.map((e) => [e.name, e.chunks]));
      const currentNames = new Set(currentHashesMap.keys());

      deletedPaths.push(
        ...Array.from(prevMap.keys()).filter((name) => !currentNames.has(name)),
      );

      currentHashesMap.forEach((currentChunks, testPath) => {
        const prevChunks = prevMap.get(testPath);

        if (!prevChunks) {
          affectedPaths.add(testPath);
          return;
        }

        const currentChunkNames = Object.keys(currentChunks);
        const prevChunkNames = Object.keys(prevChunks);
        if (currentChunkNames.length !== prevChunkNames.length) {
          affectedPaths.add(testPath);
          return;
        }

        const hasChanges = currentChunkNames.some(
          (chunkName) => prevChunks[chunkName] !== currentChunks[chunkName],
        );

        if (hasChanges) {
          affectedPaths.add(testPath);
        }
      });
    }

    return { affectedPaths, deletedPaths };
  };

  const previousSetupHashes = buildData.setupEntryToChunkHashes;
  const previousEntryHashes = buildData.entryToChunkHashes;

  const setupEntryToChunkHashesMap = new Map<string, Record<string, string>>();
  setupEntries.forEach((entry) => {
    buildChunkHashes(entry, setupEntryToChunkHashesMap);
  });

  const setupEntryToChunkHashes: TestEntryToChunkHashes = Array.from(
    setupEntryToChunkHashesMap.entries(),
  ).map(([name, chunks]) => ({ name, chunks }));

  buildData.setupEntryToChunkHashes = setupEntryToChunkHashes;

  const entryToChunkHashesMap = new Map<string, Record<string, string>>();
  entries.forEach((entry) => {
    buildChunkHashes(entry, entryToChunkHashesMap);
  });

  const entryToChunkHashes: TestEntryToChunkHashes = Array.from(
    entryToChunkHashesMap.entries(),
  ).map(([name, chunks]) => ({ name, chunks }));

  buildData.entryToChunkHashes = entryToChunkHashes;

  const referencedChunkFiles = new Set<string>();
  for (const entry of [...setupEntries, ...entries]) {
    for (const file of entry.files || []) {
      referencedChunkFiles.add(file);
    }
  }
  buildData.chunkHashesByFile = Object.fromEntries(
    Array.from(chunkHashesByFile.entries()).filter(([file]) =>
      referencedChunkFiles.has(file),
    ),
  );
  buildData.runtimeChunkFiles = Array.from(runtimeChunkFiles).filter((file) =>
    referencedChunkFiles.has(file),
  );

  const { affectedPaths: affectedSetupPaths, deletedPaths: deletedSetups } =
    processEntryChanges(previousSetupHashes, setupEntryToChunkHashesMap);

  if (affectedSetupPaths.size > 0 || deletedSetups.length > 0) {
    return { affectedEntries: entries, deletedEntries: [] };
  }

  const { affectedPaths: affectedTestPaths, deletedPaths } =
    processEntryChanges(previousEntryHashes, entryToChunkHashesMap);

  const affectedEntries = Array.from(affectedTestPaths)
    .map((testPath) => entryByTestPath.get(testPath))
    .filter((entry): entry is EntryInfo => entry !== undefined);

  return { affectedEntries, deletedEntries: deletedPaths };
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
  isWatchMode,
}: {
  isWatchMode: boolean;
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
    /** affected test entries only available in watch mode */
    affectedEntries: EntryInfo[];
    /** deleted test entries only available in watch mode */
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

  // Ensure that when readFile is called in parallel, the file content will not be read into memory repeatedly
  const cachedReadFilePromises = new Map<string, Promise<string>>();
  const readFile = async (fileName: string) => {
    if (cachedReadFilePromises.has(fileName))
      return cachedReadFilePromises.get(fileName)!;
    const promise = new Promise<string>((resolve, reject) => {
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
    cachedReadFilePromises.set(fileName, promise);
    promise.finally(() => cachedReadFilePromises.delete(fileName));
    return promise;
  };

  const buildData: Record<
    string,
    {
      entryToChunkHashes?: TestEntryToChunkHashes;
      setupEntryToChunkHashes?: TestEntryToChunkHashes;
      chunkHashesByFile?: Record<string, string>;
      runtimeChunkFiles?: string[];
    }
  > = {};

  const getEntryFiles = (manifest: ManifestData, outputPath: string) => {
    const entryFiles: Record<string, string[]> = {};

    const entries = Object.keys(manifest.entries);

    for (const entry of entries) {
      const data = manifest.entries[entry];
      entryFiles[entry] = (
        (data?.initial?.js || [])
          .concat(data?.async?.js || [])
          .concat(
            data?.assets?.filter((asset) => !asset.endsWith('.map')) || [],
          ) || []
      ).map((file: string) =>
        file.startsWith(outputPath) ? file : path.join(outputPath, file),
      );
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
      chunks: true,
      timings: true,
    });

    const entryFiles = getEntryFiles(manifest, outputPath!);
    const runtimeChunkFiles = getRuntimeChunkFiles({
      chunks,
      outputPath: outputPath!,
      runtimeChunkName: `${environmentName}-${RUNTIME_CHUNK_NAME}`,
    });
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
      const runtimeDistPath = entryFiles[entry]?.find((file) =>
        runtimeChunkFiles.has(file),
      );

      if (setupFiles[environmentName]?.[entry]) {
        setupEntries.push({
          distPath,
          runtimeDistPath,
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
          runtimeDistPath,
          testPath: sourceEntries[entry],
          files: entryFiles[entry],
          chunks: e.chunks || [],
        });
      } else if (globalSetupFiles?.[environmentName]?.[entry]) {
        globalSetupEntries.push({
          distPath,
          runtimeDistPath,
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
    const { affectedEntries, deletedEntries } = isWatchMode
      ? calcEntriesToRerun(
          entries,
          chunks,
          buildData[environmentName],
          outputPath!,
          `${environmentName}-${RUNTIME_CHUNK_NAME}`,
          setupEntries,
        )
      : { affectedEntries: [], deletedEntries: [] };

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
