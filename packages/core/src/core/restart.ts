import path from 'node:path';
import type { ChokidarOptions } from 'chokidar';
import { type CommonOptions, runRest } from '../cli/commands';
import { exitReporters } from '../reporter';
import type { RstestInstance } from '../types';
import { color, isColorSupported, isTTY, logger } from '../utils';
import { createChokidar } from '../utils/watchFiles';
import { runLifecycleStep } from './finalizeRun';

const clearConsole = () => {
  if (isTTY() && !process.env.DEBUG && isColorSupported) {
    process.stdout.write('\x1B[H\x1B[2J');
  }
};

export async function beforeRestart({
  rstest,
  beforeRestart: cleanup,
  filePath,
  clear = true,
}: {
  rstest: {
    context: Pick<
      RstestInstance['context'],
      'closeWatchSession' | 'reporters' | 'rootPath'
    >;
  };
  beforeRestart?: () => void | Promise<void>;
  filePath?: string;
  clear?: boolean;
}): Promise<void> {
  if (clear) {
    clearConsole();
  }

  if (filePath) {
    const filename = path.relative(rstest.context.rootPath, filePath);
    logger.info(`restarting Rstest as ${color.yellow(filename)} changed\n`);
  } else {
    logger.info('restarting Rstest...\n');
  }

  const step = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await runLifecycleStep(label, fn);
    } catch (error) {
      logger.log(color.red(`Error during cleanup: ${error}`));
    }
  };

  // Keep uncaught handlers armed while the watch session tears down.
  await step('watch session cleanup', async () => {
    await rstest.context.closeWatchSession?.();
  });
  await exitReporters(rstest.context);
  await step('restart cleanup', async () => {
    await cleanup?.();
  });
}

const restart = async ({
  rstest,
  beforeRestart: cleanup,
  filePath,
  clear = true,
  options,
  filters,
}: {
  rstest: RstestInstance;
  beforeRestart?: () => void | Promise<void>;
  options: CommonOptions;
  filters: Array<string | number>;
  filePath?: string;
  clear?: boolean;
}): Promise<boolean> => {
  await beforeRestart({
    rstest,
    beforeRestart: cleanup,
    filePath,
    clear,
  });

  await runRest({ options, filters, command: 'watch' });

  return true;
};

export async function watchFilesForRestart({
  rstest,
  beforeRestart,
  watchOptions,
  options,
  filters,
}: {
  options: CommonOptions;
  filters: Array<string | number>;
  rstest: RstestInstance;
  beforeRestart?: () => void | Promise<void>;
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

  let restarting = false;

  const onChange = async (filePath: string) => {
    if (restarting) {
      return;
    }
    restarting = true;

    const restarted = await restart({
      rstest,
      beforeRestart,
      options,
      filters,
      filePath,
    });

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
