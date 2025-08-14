import {
  createRsbuild,
  type ManifestData,
  type RsbuildInstance,
  logger as RsbuildLogger,
  type RsbuildPlugin,
  type Rspack,
} from '@rsbuild/core';
import path from 'pathe';
import type { EntryInfo, RstestContext, SourceMapInput } from '../types';
import { isDebug } from '../utils';
import { pluginBasic } from './plugins/basic';
import { pluginCSSFilter } from './plugins/css-filter';
import { pluginEntryWatch } from './plugins/entry';
import { pluginExternal } from './plugins/external';
import { pluginIgnoreResolveError } from './plugins/ignoreResolveError';
import { pluginInspect } from './plugins/inspect';
import { pluginMockRuntime } from './plugins/mockRuntime';
import { pluginCacheControl } from './plugins/moduleCacheControl';

function parseInlineSourceMap(code: string) {
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
    const sourceMap = JSON.parse(decodedStr);
    return sourceMap;
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
  globTestSourceEntries: () => Promise<Record<string, string>>,
  setupFiles: Record<string, string>,
): Promise<RsbuildInstance> => {
  const {
    command,
    normalizedConfig: {
      isolate,
      plugins,
      resolve,
      source,
      output,
      tools,
      testEnvironment,
      performance,
      dev = {},
    },
  } = context;
  const debugMode = isDebug();

  RsbuildLogger.level = debugMode ? 'verbose' : 'error';
  const writeToDisk = dev.writeToDisk || debugMode;

  const rsbuildInstance = await createRsbuild({
    callerName: 'rstest',
    rsbuildConfig: {
      tools,
      resolve,
      source,
      output,
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
      performance,
      plugins: [
        ...(plugins || []),
        pluginBasic(context),
        pluginIgnoreResolveError,
        pluginMockRuntime,
        pluginCSSFilter(),
        pluginEntryWatch({
          globTestSourceEntries,
          setupFiles,
          configFilePath: context.configFilePath,
          isWatch: command === 'watch',
        }),
        pluginExternal(testEnvironment),
        !isolate ? pluginCacheControl(Object.values(setupFiles)) : null,
        pluginInspect(),
      ].filter(Boolean) as RsbuildPlugin[],
    },
  });

  return rsbuildInstance;
};

export const createRsbuildServer = async ({
  name,
  globTestSourceEntries,
  setupFiles,
  rsbuildInstance,
  normalizedConfig,
}: {
  rsbuildInstance: RsbuildInstance;
  name: string;
  normalizedConfig: RstestContext['normalizedConfig'];
  globTestSourceEntries: () => Promise<Record<string, string>>;
  setupFiles: Record<string, string>;
  rootPath: string;
}): Promise<{
  getRsbuildStats: (options?: { fileFilters?: string[] }) => Promise<{
    buildTime: number;
    hash?: string;
    entries: EntryInfo[];
    setupEntries: EntryInfo[];
    assetFiles: Record<string, string>;
    sourceMaps: Record<string, SourceMapInput>;
    getSourcemap: (sourcePath: string) => SourceMapInput | null;
  }>;
  closeServer: () => Promise<void>;
}> => {
  // Read files from memory via `rspackCompiler.outputFileSystem`
  let rspackCompiler: Rspack.Compiler | Rspack.MultiCompiler | undefined;

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
    await rsbuildInstance.inspectConfig({
      writeToDisk: true,
      extraConfigs: {
        rstest: normalizedConfig,
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

  const getRsbuildStats = async ({
    fileFilters,
  }: { fileFilters?: string[] } | undefined = {}) => {
    const stats = await devServer.environments[name]!.getStats();

    const manifest = devServer.environments[name]!.context
      .manifest as ManifestData;

    const {
      entrypoints,
      outputPath,
      assets,
      hash,
      time: buildTime,
    } = stats.toJson({
      all: false,
      hash: true,
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

      const entries = Object.keys(manifest.entries);

      for (const entry of entries) {
        const data = manifest.entries[entry];
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
        });
      }
    }

    const inlineSourceMap =
      stats.compilation.options.devtool === 'inline-source-map';

    const sourceMaps: Record<string, SourceMapInput> = Object.fromEntries(
      (
        await Promise.all(
          assets!.map(async (asset) => {
            const assetFilePath = path.join(outputPath!, asset.name);

            if (inlineSourceMap) {
              const content = await readFile(assetFilePath);
              return [assetFilePath, parseInlineSourceMap(content)];
            }
            const sourceMapPath = asset?.info.related?.sourceMap?.[0];

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
      hash,
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
    };
  };

  return {
    closeServer: devServer.close,
    getRsbuildStats,
  };
};
