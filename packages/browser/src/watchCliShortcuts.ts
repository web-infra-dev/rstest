import { color, logger } from '@rstest/core/browser';

const isTTY = (): boolean => Boolean(process.stdin.isTTY && !process.env.CI);

export const isBrowserWatchCliShortcutsEnabled = (): boolean => isTTY();

export const getBrowserWatchCliShortcutsHintMessage = (): string => {
  return `  ${color.dim('press')} ${color.bold('q')} ${color.dim('to quit')}\n`;
};

export const logBrowserWatchReadyMessage = (
  enableCliShortcuts: boolean,
): void => {
  logger.log(color.green('  Waiting for file changes...'));

  if (enableCliShortcuts) {
    logger.log(getBrowserWatchCliShortcutsHintMessage());
  }
};

export async function setupBrowserWatchCliShortcuts({
  close,
}: {
  close: () => Promise<void>;
}): Promise<() => void> {
  const { emitKeypressEvents } = await import('node:readline');

  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  let isClosing = false;

  const handleKeypress = (
    str: string,
    key: { name: string; ctrl: boolean },
  ) => {
    if (key.ctrl && key.name === 'c') {
      process.kill(process.pid, 'SIGINT');
      return;
    }

    if (key.ctrl && key.name === 'z') {
      if (process.platform !== 'win32') {
        process.kill(process.pid, 'SIGTSTP');
      }
      return;
    }

    if (str !== 'q' || isClosing) {
      return;
    }

    // TODO: Support more browser watch shortcuts only after this path is
    // refactored to share the same shortcut model as node mode.
    isClosing = true;
    void (async () => {
      try {
        await close();
      } finally {
        process.exit(0);
      }
    })();
  };

  process.stdin.on('keypress', handleKeypress);

  return () => {
    try {
      process.stdin.setRawMode(false);
      process.stdin.pause();
    } catch {}

    process.stdin.off('keypress', handleKeypress);
  };
}
