import type { RstestContext } from '../types';
import { clearScreen, color, isTTY, logger } from '../utils';

export const isCliShortcutsEnabled = (): boolean => isTTY('stdin');

/**
 * Watch-ready banner printed after the initial run and every rerun. Shared by
 * the node watch loop and the browser watch host so the hint text cannot drift.
 */
export const logWatchReadyMessage = (
  context: RstestContext,
  enableCliShortcuts: boolean,
): void => {
  logger.log(color.green('  Waiting for file changes...'));

  if (enableCliShortcuts) {
    if (context.snapshotManager.summary.unmatched) {
      logger.log(
        `  ${color.dim('press')} ${color.yellow(color.bold('u'))} ${color.dim('to update snapshot')}${color.dim(', press')} ${color.bold('h')} ${color.dim('to show help')}\n`,
      );
    } else {
      logger.log(
        `  ${color.dim('press')} ${color.bold('h')} ${color.dim('to show help')}${color.dim(', press')} ${color.bold('q')} ${color.dim('to quit')}\n`,
      );
    }
  }
};

type CliShortcut = {
  /**
   * The key to trigger the shortcut.
   */
  key: string;
  /**
   * The description of the shortcut.
   */
  description: string;
  /**
   * The action to execute when the shortcut is triggered.
   */
  action: () => void | Promise<void>;
};

const notSupportedHint = (key: string): CliShortcut['action'] => {
  return () => {
    logger.log(
      color.yellow(`\n'${key}' is not yet supported in browser watch.\n`),
    );
  };
};

const greyedDescription = (key: string, text: string): string =>
  `${color.bold(key)}  ${color.dim(`${text} (not yet supported in browser watch)`)}`;

/**
 * A shortcut whose callback a run type may not support yet: present callback
 * ⇒ real description/action, absent ⇒ greyed description + hint action.
 */
const optionalShortcut = (
  key: string,
  label: string,
  action: CliShortcut['action'] | undefined,
): CliShortcut => ({
  key,
  description: action
    ? `${color.bold(key)}  ${color.dim(label)}`
    : greyedDescription(key, label),
  action: action ?? notSupportedHint(key),
});

/**
 * Install the single watch-mode stdin owner. Actions other than quit are
 * optional: a run type that cannot support one yet (browser-only watch)
 * omits the callback and the key shows a greyed hint instead — there is
 * never a second raw-mode stdin subscriber.
 */
export async function setupCliShortcuts({
  closeServer,
  runAll,
  updateSnapshot,
  runFailedTests,
  runWithTestNamePattern,
  runWithFileFilters,
}: {
  runFailedTests?: () => Promise<void>;
  closeServer: () => Promise<void>;
  runAll?: () => Promise<void>;
  updateSnapshot?: () => Promise<void>;
  runWithTestNamePattern?: (pattern: string | undefined) => Promise<void>;
  runWithFileFilters?: (filters: string[] | undefined) => Promise<void>;
}): Promise<() => void> {
  const { createInterface, emitKeypressEvents } = await import('node:readline');

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // Ensure keypress events are emitted
  emitKeypressEvents(process.stdin);

  // Set raw mode to capture individual keystrokes
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  let isPrompting = false;

  const clearCurrentInputLine = (): void => {
    try {
      process.stdout.write('\r\x1b[2K');
    } catch {
      // ignore
    }
  };

  const promptInput = (
    promptText: string,
    onComplete: (value: string | undefined) => Promise<void>,
  ): void => {
    if (isPrompting) return;
    isPrompting = true;

    // Local buffer for input
    let buffer = '';

    const render = () => {
      // Clear line and render prompt + buffer
      // Using carriage return to start of line and overwrite
      process.stdout.write(`\r\x1b[2K${promptText}${buffer}`);
    };

    render();

    const onPromptKey = async (
      str: string,
      key: { name: string; ctrl: boolean; meta: boolean; shift: boolean },
    ) => {
      // Prevent global handler while prompting
      if (!isPrompting) return;

      if (key.ctrl && key.name === 'c') {
        // Send SIGINT to self to trigger proper cleanup
        process.kill(process.pid, 'SIGINT');
        return;
      }

      if (key.ctrl && key.name === 'z') {
        if (process.platform !== 'win32') {
          process.kill(process.pid, 'SIGTSTP');
        }
        return;
      }

      if (key.name === 'return' || key.name === 'enter') {
        // Finish input
        process.stdin.off('keypress', onPromptKey);
        process.stdout.write('\n');
        const value = buffer.trim() === '' ? undefined : buffer.trim();
        isPrompting = false;
        await onComplete(value);
        return;
      }

      if (key.name === 'escape') {
        clearCurrentInputLine();
        // Cancel input
        process.stdin.off('keypress', onPromptKey);
        isPrompting = false;
        return;
      }

      if (key.name === 'backspace') {
        buffer = buffer.slice(0, -1);
        render();
        return;
      }

      // Append character
      if (typeof str === 'string' && str.length === 1) {
        buffer += str;
        render();
      }
    };

    process.stdin.on('keypress', onPromptKey);
  };

  const shortcuts = [
    optionalShortcut('f', 'rerun failed tests', runFailedTests),
    optionalShortcut('a', 'rerun all tests', runAll),
    optionalShortcut('u', 'update snapshot', updateSnapshot),
    optionalShortcut(
      't',
      'filter by a test name regex pattern',
      runWithTestNamePattern &&
        (() => {
          clearCurrentInputLine();
          promptInput(
            'Enter test name pattern (empty to clear): ',
            async (pattern) => {
              await runWithTestNamePattern(pattern);
            },
          );
        }),
    ),
    optionalShortcut(
      'p',
      'filter by a filename regex pattern',
      runWithFileFilters &&
        (() => {
          clearCurrentInputLine();
          promptInput(
            'Enter file name pattern (empty to clear): ',
            async (input) => {
              const filters = input
                ? input.split(/\s+/).filter(Boolean)
                : undefined;
              await runWithFileFilters(filters);
            },
          );
        }),
    ),
    {
      key: 'c',
      description: `${color.bold('c')}  ${color.dim('clear screen')}`,
      action: () => {
        clearScreen(true);
      },
    },
    {
      key: 'q',
      description: `${color.bold('q')}  ${color.dim('quit process')}`,
      action: async () => {
        try {
          await closeServer();
        } finally {
          process.exit(0);
        }
      },
    },
  ] satisfies CliShortcut[];

  const handleKeypress = (
    str: string,
    key: { name: string; ctrl: boolean; meta: boolean; shift: boolean },
  ) => {
    if (isPrompting) return; // Ignore global shortcuts while prompting

    // Handle Ctrl+C - let the process signal handler take care of cleanup
    if (key.ctrl && key.name === 'c') {
      // Send SIGINT to self to trigger proper cleanup
      process.kill(process.pid, 'SIGINT');
      return;
    }

    if (key.ctrl && key.name === 'z') {
      if (process.platform !== 'win32') {
        process.kill(process.pid, 'SIGTSTP');
      }
      return;
    }

    // Check shortcuts
    for (const shortcut of shortcuts) {
      if (str === shortcut.key) {
        clearCurrentInputLine();
        void shortcut.action();
        return;
      }
    }

    // Show help information
    if (str === 'h') {
      clearCurrentInputLine();
      let message = `  ${color.bold(color.blue('Shortcuts:'))}\n`;
      for (const shortcut of shortcuts) {
        message += `  ${shortcut.description}\n`;
      }
      logger.log(message);
    }
  };

  process.stdin.on('keypress', handleKeypress);

  return () => {
    try {
      process.stdin.setRawMode(false);
      process.stdin.pause();
    } catch {
      // ignore
    }
    process.stdin.off('keypress', handleKeypress);
    rl.close();
  };
}
