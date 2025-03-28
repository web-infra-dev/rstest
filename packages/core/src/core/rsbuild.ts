import fs from 'node:fs';
import path from 'node:path';
import {
  type RsbuildInstance,
  logger as RsbuildLogger,
  type RsbuildPlugin,
  type Rspack,
  createRsbuild,
} from '@rsbuild/core';
import type { EntryInfo, SourceMapInput } from '../types';
import { isDebug } from '../utils';

const isMultiCompiler = <
  C extends Rspack.Compiler = Rspack.Compiler,
  M extends Rspack.MultiCompiler = Rspack.MultiCompiler,
>(
  compiler: C | M,
): compiler is M => {
  return 'compilers' in compiler && Array.isArray(compiler.compilers);
};

export const prepareRsbuild = async (
  name: string,
  sourceEntries: Record<string, string>,
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
          source: {
            entry: {
              ...sourceEntries,
              ...setupFiles,
            },
          },
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
            },
          },
        },
      },
    },
  });

  return rsbuildInstance;
};

export const createRsbuildServer = async ({
  name,
  sourceEntries,
  setupFiles,
  rsbuildInstance,
}: {
  rsbuildInstance: RsbuildInstance;
  name: string;
  sourceEntries: Record<string, string>;
  setupFiles: Record<string, string>;
}): Promise<{
  entries: EntryInfo[];
  setupEntries: EntryInfo[];
  assetFiles: Record<string, string>;
  getSourcemap: (sourcePath: string) => Promise<SourceMapInput | null>;
  close: () => Promise<void>;
}> => {
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

  const stats = await devServer.environments[name]!.getStats();

  const outputFileSystem =
    (isMultiCompiler(rspackCompiler!)
      ? rspackCompiler.compilers[0]!.outputFileSystem
      : rspackCompiler!.outputFileSystem) || fs;

  const { entrypoints, outputPath, assets } = stats.toJson({
    entrypoints: true,
    outputPath: true,
    assets: true,
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

  return {
    entries,
    setupEntries,
    // Resources need to be obtained synchronously when the test is loaded, so files need to be read in advance
    assetFiles: Object.fromEntries(
      await Promise.all(
        assets!.map(async (a) => {
          const filePath = path.join(outputPath!, a.name);
          return [filePath, await readFile(filePath)];
        }),
      ),
    ),
    getSourcemap: async (
      sourcePath: string,
    ): Promise<SourceMapInput | null> => {
      const asset = assets?.find(
        (asset) => path.join(outputPath!, asset.name) === sourcePath,
      );
      const sourceMapPath = asset?.info.related?.sourceMap?.[0];

      if (sourceMapPath) {
        const filePath = path.join(outputPath!, sourceMapPath);
        const sourceMap = await readFile(filePath);
        return JSON.parse(sourceMap);
      }
      return null;
    },
    close: devServer.close,
  };
};
