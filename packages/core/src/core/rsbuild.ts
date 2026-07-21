import {
  createRsbuild,
  type ManifestData,
  type RsbuildConfig,
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
import { pluginBasic } from './plugins/basic';
import { pluginEntryWatch } from './plugins/entry';
import { pluginExternal } from './plugins/external';
import { pluginIgnoreResolveError } from './plugins/ignoreResolveError';
import { pluginInspect } from './plugins/inspect';
import { isNodeProject } from './isBrowserProject';
import { pluginMockRuntime } from './plugins/mockRuntime';
import { pluginCacheControl } from './plugins/moduleCacheControl';
import {
  getRsbuildEnvironmentConfig,
  initModifyRstestConfigHooks,
} from './modifyRstestConfig';
import { isRuntimeChunk, runtimeChunkNameForEnvironment } from './runtimeChunk';
import {
  createSetupFileState,
  type SetupFileProjects,
  type SetupFileState,
} from './setupFileState';

type TestEntryToChunkHashes = {
  name: string;
  /** key is chunk asset file path, value is chunk hash */
  chunks: Record<string, string>;
}[];

export const syncCoverageSetupExcludes = (
  coverage: NormalizedProjectConfig['coverage'] | undefined,
  setupPaths: string[],
): void => {
  if (!coverage?.enabled || !setupPaths.length) {
    return;
  }

  coverage.exclude = Array.from(new Set([...coverage.exclude, ...setupPaths]));
};

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
    if (!isRuntimeChunk(chunk, runtimeChunkName)) {
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

type PrepareRsbuildOptions = {
  context: RstestContext;
  globTestSourceEntries: (name: string) => Promise<Record<string, string>>;
  setupFileState?: SetupFileState;
  getSetupFileProjects?: () => SetupFileProjects;
  /**
   * Explicit list of projects to include in the Rsbuild instance.
   *
   * Most callers still pass node-mode projects for execution, but related-test
   * resolution also reuses this node-targeted build to collect a uniform module
   * graph for browser projects. If browser graph collection ever needs a
   * materially different build pipeline, split that behavior at the caller.
   */
  targetProjects?: ProjectContext[];
  exposeRstestAPIProjects?: ProjectContext[];
  extraPlugins?: RsbuildPlugin[];
  onModifyRstestConfigApplied?: () => Promise<void>;
  onRsbuildConfigResolved?: () => Promise<void>;
  onCoveragePluginLoadError?: (error: unknown) => void;
};

export const addCoveragePlugin = async (
  rsbuildInstance: RsbuildInstance,
  context: RstestContext,
): Promise<void> => {
  const {
    command,
    normalizedConfig: { coverage },
  } = context;

  if (coverage?.enabled && command !== 'list') {
    const { loadCoverageProvider } = await import('../coverage');
    const { pluginCoverage } = await loadCoverageProvider(
      coverage,
      context.rootPath,
    );
    rsbuildInstance.addPlugins([pluginCoverage(coverage)]);
  }
};

/**
 * In-memory host compile server: no printed urls, no fixed port, no static
 * hosting. Shared with the browser globalSetup stage's one-shot compile so
 * the two host rsbuild instances cannot drift.
 */
export const hostServerConfig: NonNullable<RsbuildConfig['server']> = {
  printUrls: false,
  strictPort: false,
  middlewareMode: true,
  compress: false,
  cors: false,
  publicDir: false,
};

export const prepareRsbuild = async ({
  context,
  globTestSourceEntries,
  setupFileState = createSetupFileState(),
  getSetupFileProjects,
  targetProjects,
  exposeRstestAPIProjects,
  extraPlugins = [],
  onModifyRstestConfigApplied,
  onRsbuildConfigResolved,
  onCoveragePluginLoadError,
}: PrepareRsbuildOptions): Promise<RsbuildInstance> => {
  const {
    command,
    normalizedConfig: { coverage, dev = {}, isolate, pool },
  } = context;
  const { setupFiles, globalSetupFiles, getSetupPaths } = setupFileState;

  // Default execution still excludes browser projects. Callers can opt in to a
  // broader project set when they only need graph information.
  const projects = targetProjects?.length
    ? targetProjects
    : context.projects.filter(isNodeProject);
  const debugMode = isDebug();

  const updateSetupFileMaps = () => {
    const setupFileProjects = getSetupFileProjects?.() ?? {
      setupProjects: projects,
      globalSetupProjects: context.projects,
    };
    setupFileState.refresh(setupFileProjects);
    if (command !== 'list') {
      syncCoverageSetupExcludes(coverage, getSetupPaths());
    }
  };

  RsbuildLogger.level = debugMode ? 'verbose' : 'error';

  const writeToDisk = dev.writeToDisk || debugMode;
  const rsbuildInstance = await createRsbuild({
    callerName: 'rstest',
    config: {
      root: context.rootPath,
      server: { ...hostServerConfig },
      dev: {
        hmr: false,
        writeToDisk,
      },
      environments: Object.fromEntries(
        projects.map((project) => [
          project.environmentName,
          getRsbuildEnvironmentConfig(project),
        ]),
      ),
      plugins: [
        pluginBasic(context),
        pluginIgnoreResolveError,
        pluginMockRuntime,
        pluginEntryWatch({
          globTestSourceEntries,
          setupFiles,
          globalSetupFiles,
          context,
          isWatch: command === 'watch',
        }),
        pluginExternal(context),
        !isolate ? pluginCacheControl(getSetupPaths) : null,
        pluginInspect({ poolExecArgv: pool.execArgv }),
        ...extraPlugins,
      ].filter(Boolean) as RsbuildPlugin[],
    },
  });

  initModifyRstestConfigHooks(
    context,
    rsbuildInstance,
    projects,
    exposeRstestAPIProjects,
    {
      onModifyRstestConfigApplied,
      onRsbuildConfigResolved: async () => {
        await onRsbuildConfigResolved?.();
        updateSetupFileMaps();
      },
    },
  );

  try {
    await addCoveragePlugin(rsbuildInstance, context);
  } catch (error) {
    if (!onCoveragePluginLoadError) {
      throw error;
    }
    onCoveragePluginLoadError(error);
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
    const chunkIsRuntime = isRuntimeChunk(chunk, runtimeChunkName);

    for (const file of chunk.files || []) {
      const filePath = path.join(outputPath, String(file));
      chunkHashesByFile.set(filePath, chunk.hash ?? '');

      if (chunkIsRuntime) {
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
  inspectedConfig?: RstestContext['normalizedConfig'] & {
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

  rsbuildInstance.onAfterCreateCompiler(({ compiler }) => {
    // outputFileSystem to be updated later by `rsbuild-dev-middleware`
    rspackCompiler = compiler;
  });

  const devServer = await rsbuildInstance.createDevServer({
    getPortSilently: true,
  });

  if (isDebug() && inspectedConfig) {
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
          typeof data === 'string' ? data : data!.toString('utf-8');

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
      runtimeChunkName: runtimeChunkNameForEnvironment(environmentName),
    });
    const entries: EntryInfo[] = [];
    const setupEntries: EntryInfo[] = [];
    const globalSetupEntries: EntryInfo[] = [];
    const sourceEntries = await globTestSourceEntries(environmentName);

    // Per-asset size lookup for entrypoints that only report asset names.
    // Entrypoint-level `assetsSize`/`assets[].size` are optional in the rspack
    // stats types, but the top-level `assets[].size` is always present.
    const assetSizes = new Map(assets!.map((a) => [a.name, a.size]));

    for (const entry of Object.keys(entrypoints!)) {
      const e = entrypoints![entry]!;

      const distPath = path.join(
        outputPath!,
        e.assets![e.assets!.length - 1]!.name,
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
          size:
            e.assetsSize ??
            (e.assets ?? []).reduce(
              (sum, a) => sum + (a.size ?? assetSizes.get(a.name) ?? 0),
              0,
            ),
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
          runtimeChunkNameForEnvironment(environmentName),
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

      if (enableAssetsCache) cachedAssetFiles.set(name, content);

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

      if (enableAssetsCache && content) cachedSourceMaps.set(name, content);

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
