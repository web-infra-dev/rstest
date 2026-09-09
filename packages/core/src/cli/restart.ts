import path from 'node:path';
import { color, isColorSupported, isTTY, logger } from '../utils';
import { createChokidar } from '../utils/watchFiles';

export async function watchFilesForRestart({
  configFilePaths,
  rootPath,
  restart,
}: {
  configFilePaths: string[];
  rootPath: string;
  restart: () => Promise<void>;
}): Promise<void> {
  if (configFilePaths.length === 0) {
    return;
  }

  const watcher = await createChokidar(configFilePaths, rootPath, {
    ignoreInitial: true,
    ignorePermissionErrors: true,
    // `fs.watch` is only armed some time after `ready`, so a config edit right
    // after startup is dropped. Polling this handful of files is cheap and its
    // `ready` means the stat baselines are recorded.
    usePolling: true,
    interval: 100,
  });

  const onChange = async (filePath: string) => {
    await watcher.close();
    if (isTTY() && !process.env.DEBUG && isColorSupported) {
      process.stdout.write('\x1B[H\x1B[2J');
    }
    const filename = path.relative(rootPath, filePath);
    logger.info(`restarting Rstest as ${color.yellow(filename)} changed\n`);
    await restart();
  };

  watcher.on('add', onChange);
  watcher.on('change', onChange);
  watcher.on('unlink', onChange);
}
