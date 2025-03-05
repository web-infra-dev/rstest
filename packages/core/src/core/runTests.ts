import { logger as RsbuildLogger, createRsbuild } from '@rsbuild/core';
import { glob } from 'tinyglobby';
import type { RstestContext } from '../types';
import { color } from '../utils/helper';
import { isDebug, logger } from '../utils/logger';

const getTestEntries = async (context: RstestContext) => {
  const { include, exclude, root } = context.normalizedConfig;
  const entries = await glob(include, {
    cwd: root,
    absolute: true,
    ignore: exclude,
  });

  return Object.fromEntries(
    entries.map((entry, index) => {
      return [index, entry];
    }),
  );
};

export async function runTests(context: RstestContext): Promise<void> {
  const entries = await getTestEntries(context);

  if (!Object.keys(entries).length) {
    const { include, exclude } = context.normalizedConfig;
    logger.log(color.red('No test files found.\n'));
    logger.log(color.gray('include:'), include.join(color.gray(', ')));
    logger.log(color.gray('exclude:'), exclude.join(color.gray(', ')));
    logger.log('');
    return;
  }

  RsbuildLogger.level = isDebug() ? 'verbose' : 'error';

  const rsbuildInstance = await createRsbuild({
    rsbuildConfig: {
      server: {
        printUrls: false,
        strictPort: false,
      },
      environments: {
        rstest: {
          source: {
            entry: entries,
          },
          dev: {
            writeToDisk: false,
          },
          output: {
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

  // TODO: use rstest/runner instead
  await Promise.all(
    Object.keys(entries).map((entry) => {
      return devServer.environments.rstest?.loadBundle(entry);
    }),
  );

  await devServer.close();
}
