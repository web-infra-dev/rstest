import fs from 'node:fs';
import path from 'node:path';
import {
  logger as RsbuildLogger,
  type RsbuildPlugin,
  type Rspack,
  createRsbuild,
} from '@rsbuild/core';
import type { EntryInfo } from '../types';
import { isDebug } from '../utils';

const isMultiCompiler = <
  C extends Rspack.Compiler = Rspack.Compiler,
  M extends Rspack.MultiCompiler = Rspack.MultiCompiler,
>(
  compiler: C | M,
): compiler is M => {
  return 'compilers' in compiler && Array.isArray(compiler.compilers);
};

export const createRsbuildServer = async (
  name: string,
  sourceEntries: Record<string, string>,
): Promise<{
  entries: EntryInfo[];
  assetFiles: Record<string, string>;
  close: () => Promise<void>;
}> => {
  RsbuildLogger.level = isDebug() ? 'verbose' : 'error';

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

  const rsbuildInstance = await createRsbuild({
    rsbuildConfig: {
      server: {
        printUrls: false,
        strictPort: false,
      },
      environments: {
        [name]: {
          source: {
            entry: sourceEntries,
          },
          dev: {
            writeToDisk: false,
          },
          output: {
            externals: {
              '@rstest/core': 'global @rstest/core',
            },
            target: 'node',
          },
          tools: {
            rspack: (config) => {
              config.optimization = {
                ...(config.optimization || {}),
                moduleIds: 'named',
                chunkIds: 'named',
              };
            },
          },
        },
      },
      plugins: [rstestCompilerPlugin],
    },
  });
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

  const entries = Object.keys(entrypoints!).map((entry) => {
    const e = entrypoints![entry]!;

    const filePath = path.join(
      outputPath!,
      e.assets![e.assets!.length - 1]!.name,
    );

    const originPath = sourceEntries[entry]!;

    return {
      filePath,
      originPath,
    };
  });

  return {
    entries,
    assetFiles: Object.fromEntries(
      await Promise.all(
        assets!.map(async (a) => {
          const filePath = path.join(outputPath!, a.name);
          return [filePath, await readFile(filePath)];
        }),
      ),
    ),
    close: devServer.close,
  };
};
