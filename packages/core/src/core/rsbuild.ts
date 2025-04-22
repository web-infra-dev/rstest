import fs from 'node:fs';
import {
  type RsbuildInstance,
  logger as RsbuildLogger,
  type RsbuildPlugin,
  type Rspack,
  createRsbuild,
} from '@rsbuild/core';
import path from 'pathe';
import type { EntryInfo, SourceMapInput } from '../types';
import { isDebug } from '../utils';
import { pluginIgnoreResolveError } from './plugins/ignoreResolveError';

const isMultiCompiler = <
  C extends Rspack.Compiler = Rspack.Compiler,
  M extends Rspack.MultiCompiler = Rspack.MultiCompiler,
>(
  compiler: C | M,
): compiler is M => {
  return 'compilers' in compiler && Array.isArray(compiler.compilers);
};

class TestFileWatchPlugin {
  private contextToWatch: string | null = null;

  constructor(contextToWatch: string) {
    this.contextToWatch = contextToWatch;
  }

  apply(compiler: Rspack.Compiler) {
    compiler.hooks.afterCompile.tap(
      'Rstest:TestFileWatchPlugin',
      (compilation) => {
        if (this.contextToWatch === null) {
          return;
        }

        const contextDep = compilation.contextDependencies;
        if (!contextDep.has(this.contextToWatch)) {
          contextDep.add(this.contextToWatch);
        }
      },
    );
  }
}

export const prepareRsbuild = async (
  name: string,
  globTestSourceEntries: () => Promise<Record<string, string>>,
  setupFiles: Record<string, string>,
): Promise<RsbuildInstance> => {
  RsbuildLogger.level = isDebug() ? 'verbose' : 'error';

  const rsbuildInstance = await createRsbuild({
    rsbuildConfig: {
      server: {
        printUrls: false,
        strictPort: false,
        middlewareMode: true,
      },
      environments: {
        [name]: {
          dev: {
            writeToDisk: false,
          },
          output: {
            sourceMap: {
              js: 'source-map',
            },
            externals: {
              '@rstest/core': 'global @rstest/core',
            },
            target: 'node',
          },
          tools: {
            rspack: (config) => {
              config.output ??= {};
              config.output.devtoolModuleFilenameTemplate =
                '[absolute-resource-path]';

              config.optimization = {
                ...(config.optimization || {}),
                moduleIds: 'named',
                chunkIds: 'named',
              };

              config.plugins!.push(new TestFileWatchPlugin(process.cwd()));
              config.entry = async () => {
                const sourceEntries = await globTestSourceEntries();
                return {
                  ...sourceEntries,
                  ...setupFiles,
                };
              };
            },
          },
          plugins: [pluginIgnoreResolveError],
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
  rootPath,
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

      api.modifyRspackConfig((config) => {
        config?.plugins?.push(new TestFileWatchPlugin(rootPath));
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

    const {
      entrypoints,
      outputPath,
      assets,
      time: buildTime,
    } = stats.toJson({
      entrypoints: true,
      outputPath: true,
      assets: true,
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

    const entries: EntryInfo[] = [];
    const setupEntries: EntryInfo[] = [];
    const sourceEntries = await globTestSourceEntries();
    // TODO: check compile error, such as setupFiles not found
    for (const entry of Object.keys(entrypoints!)) {
      const e = entrypoints![entry]!;

      const filePath = path.join(
        outputPath!,
        e.assets![e.assets!.length - 1]!.name,
      );

      if (setupFiles[entry]) {
        setupEntries.push({
          filePath,
          originPath: setupFiles[entry],
        });
      } else if (sourceEntries[entry]) {
        entries.push({
          filePath,
          originPath: sourceEntries[entry],
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
