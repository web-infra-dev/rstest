import path from 'node:path';
import type { ChokidarOptions } from 'chokidar';
import { type CommonOptions, runRest } from '../cli/commands';
import type { RstestInstance } from '../types';
import { color, isTTY, logger } from '../utils';
import { createChokidar } from '../utils/watchFiles';

type Cleaner = () => unknown;

let cleaners: Cleaner[] = [];

/**
 * Add a cleaner to handle side effects
 */
export const onBeforeRestart = (cleaner: Cleaner): void => {
  cleaners.push(cleaner);
};

const clearConsole = () => {
  if (isTTY() && !process.env.DEBUG) {
    process.stdout.write('\x1B[H\x1B[2J');
  }
};

const beforeRestart = async ({
  filePath,
  root,
  clear = true,
}: {
  root: string;
  filePath?: string;
  clear?: boolean;
}): Promise<void> => {
  if (clear) {
    clearConsole();
  }

  if (filePath) {
    const filename = path.relative(root, filePath);
    logger.info(`restarting Rstest as ${color.yellow(filename)} changed\n`);
  } else {
    logger.info('restarting Rstest...\n');
  }

  for (const cleaner of cleaners) {
    await cleaner();
  }
  cleaners = [];
};

export const restart = async ({
  filePath,
  clear = true,
  options,
  filters,
  root,
}: {
  root: string;
  options: CommonOptions;
  filters: string[];
  filePath?: string;
  clear?: boolean;
}): Promise<boolean> => {
  await beforeRestart({ filePath, root, clear });

  await runRest({ options, filters, command: 'watch' });

  return true;
};

export async function watchFilesForRestart({
  rstest,
  watchOptions,
  options,
  filters,
}: {
  options: CommonOptions;
  filters: string[];
  rstest: RstestInstance;
  watchOptions?: ChokidarOptions;
}): Promise<void> {
  const configFilePaths = [
    rstest.context.configFilePath,
    ...rstest.context.projects.map((project) => project.configFilePath),
  ].filter(Boolean) as string[];
  if (configFilePaths.length === 0) {
    return;
  }

  const root = rstest.context.rootPath;
  const watcher = await createChokidar(configFilePaths, root, {
    // do not trigger add for initial files
    ignoreInitial: true,
    // If watching fails due to read permissions, the errors will be suppressed silently.
    ignorePermissionErrors: true,
    ...watchOptions,
  });

  let restarting = false;

  const onChange = async (filePath: string) => {
    if (restarting) {
      return;
    }
    restarting = true;

    const restarted = await restart({ options, root, filters, filePath });

    if (restarted) {
      await watcher.close();
    } else {
      logger.error('Restart failed');
    }

    restarting = false;
  };

  watcher.on('add', onChange);
  watcher.on('change', onChange);
  watcher.on('unlink', onChange);
}
