import path from 'node:path';
import type { ChokidarOptions } from 'chokidar';
import { type CommonOptions, runRest } from '../cli/commands';
import type { RstestContext, RstestInstance } from '../types';
import { color, isColorSupported, isTTY, logger } from '../utils';
import { createChokidar } from '../utils/watchFiles';

type Cleaner = () => unknown;
type WatchRestart = (filters: Array<string | number>) => Promise<void>;

type WatchRestartState = {
  restart?: WatchRestart;
  cleaners: Cleaner[];
};

const watchRestartStates = new WeakMap<RstestContext, WatchRestartState>();

const getWatchRestartState = (context: RstestContext): WatchRestartState => {
  let state = watchRestartStates.get(context);
  if (!state) {
    state = { cleaners: [] };
    watchRestartStates.set(context, state);
  }
  return state;
};

export const registerWatchRestart = (
  context: RstestContext,
  restartWatch: WatchRestart,
): void => {
  const state = getWatchRestartState(context);
  // The CLI installs the config-reload implementation before core starts the
  // watch session. Embedded callers do not have that outer command, so core
  // may install its in-process fallback later without replacing the CLI path.
  state.restart ??= restartWatch;
};

export const requestWatchRestart = (
  context: RstestContext,
  filters: Array<string | number>,
): Promise<void> => {
  const restartWatch = getWatchRestartState(context).restart;
  if (!restartWatch) {
    throw new Error('Rstest watch restart is not registered');
  }
  return restartWatch(filters);
};

/**
 * Add a cleaner to handle side effects
 */
export const onBeforeRestart = (
  context: RstestContext,
  cleaner: Cleaner,
): void => {
  getWatchRestartState(context).cleaners.push(cleaner);
};

const clearConsole = () => {
  if (isTTY() && !process.env.DEBUG && isColorSupported) {
    process.stdout.write('\x1B[H\x1B[2J');
  }
};

const beforeRestart = async ({
  context,
  filePath,
  root,
  clear = true,
}: {
  context: RstestContext;
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

  const state = getWatchRestartState(context);
  const cleaners = state.cleaners;
  state.cleaners = [];
  for (const cleaner of cleaners) {
    await cleaner();
  }
};

export const prepareWatchRestart = async ({
  context,
  root,
  clear = true,
}: {
  context: RstestContext;
  root: string;
  clear?: boolean;
}): Promise<void> => {
  await beforeRestart({ context, root, clear });
};

export const restart = async ({
  context,
  filePath,
  clear = true,
  options,
  filters,
  root,
}: {
  context: RstestContext;
  root: string;
  options: CommonOptions;
  filters: Array<string | number>;
  filePath?: string;
  clear?: boolean;
}): Promise<boolean> => {
  await beforeRestart({ context, filePath, root, clear });

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
  filters: Array<string | number>;
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
    // `fs.watch` is only armed some time after `ready`, so a config edit right
    // after startup is dropped. Polling this handful of files is cheap and its
    // `ready` means the stat baselines are recorded.
    usePolling: true,
    interval: 100,
    ...watchOptions,
  });

  onBeforeRestart(rstest.context, () => watcher.close());

  let restarting = false;

  const onChange = async (filePath: string) => {
    if (restarting) {
      return;
    }
    restarting = true;

    const restarted = await restart({
      context: rstest.context,
      options,
      root,
      filters: rstest.context.fileFilters ?? filters,
      filePath,
    });

    if (!restarted) {
      logger.error('Restart failed');
    }

    restarting = false;
  };

  watcher.on('add', onChange);
  watcher.on('change', onChange);
  watcher.on('unlink', onChange);
}
