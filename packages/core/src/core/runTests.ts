import path from 'node:path';
import { logger as RsbuildLogger, createRsbuild } from '@rsbuild/core';
import { runInPool } from '../pool';
import type { RstestContext } from '../types';
import { color, getTestEntries, isDebug, logger } from '../utils';

const createRsbuildServer = async (
  name: string,
  entries: Record<string, string>,
) => {
  RsbuildLogger.level = isDebug() ? 'verbose' : 'error';

  const rsbuildInstance = await createRsbuild({
    rsbuildConfig: {
      server: {
        printUrls: false,
        strictPort: false,
      },
      environments: {
        [name]: {
          source: {
            entry: entries,
          },
          dev: {
            // TODO: support read from memory
            writeToDisk: true,
          },
          output: {
            externals: {
              '@rstest/core': 'global @rstest/core',
            },
            target: 'node',
          },
        },
      },
    },
  });
  const devServer = await rsbuildInstance.createDevServer({
    getPortSilently: true,
  });

  if (isDebug()) {
    await rsbuildInstance.inspectConfig({ writeToDisk: true });
  }

  const stats = await devServer.environments[name]!.getStats();

  const { entrypoints, outputPath } = stats.toJson({
    entrypoints: true,
    outputPath: true,
  });

  const entryInfo = Object.keys(entrypoints!).map((entry) => {
    const e = entrypoints![entry]!;

    const filePath = path.join(
      outputPath!,
      e.assets![e.assets!.length - 1]!.name,
    );

    const originPath = entries[entry]!;

    return {
      filePath,
      originPath,
    };
  });

  return {
    entryInfo,
    close: devServer.close,
  };
};

export async function runTests(context: RstestContext): Promise<void> {
  const { include, exclude, root, name } = context.normalizedConfig;

  const entries = await getTestEntries({ include, exclude, root });

  if (!Object.keys(entries).length) {
    logger.log(color.red('No test files found.\n'));
    logger.log(color.gray('include:'), include.join(color.gray(', ')));
    logger.log(color.gray('exclude:'), exclude.join(color.gray(', ')));
    logger.log('');
    return;
  }

  const { close, entryInfo } = await createRsbuildServer(name, entries);

  await Promise.all(entryInfo.map(runInPool));

  await close();
}
