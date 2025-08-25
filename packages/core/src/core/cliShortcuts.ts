import { clearScreen, color, isTTY, logger } from '../utils';

export const isCliShortcutsEnabled = (): boolean => isTTY('stdin');

export type CliShortcut = {
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

export async function setupCliShortcuts({
  closeServer,
  runAll,
  updateSnapshot,
  runFailedTests,
  runWithTestNamePattern,
  runWithFileFilters,
}: {
  runFailedTests: () => Promise<void>;
  closeServer: () => Promise<void>;
  runAll: () => Promise<void>;
  updateSnapshot: () => Promise<void>;
  runWithTestNamePattern: (pattern: string | undefined) => Promise<void>;
  runWithFileFilters: (filters: string[] | undefined) => Promise<void>;
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
    } catch {}
  };

  const promptInput = async (
    promptText: string,
    onComplete: (value: string | undefined) => Promise<void>,
  ): Promise<void> => {
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
        process.exit(0);
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
    {
      key: 'f',
      description: `${color.bold('f')}  ${color.dim('rerun failed tests')}`,
      action: async () => {
        await runFailedTests();
      },
    },
    {
      key: 'a',
      description: `${color.bold('a')}  ${color.dim('rerun all tests')}`,
      action: async () => {
        await runAll();
      },
    },
    {
      key: 'u',
      description: `${color.bold('u')}  ${color.dim('update snapshot')}`,
      action: async () => {
        await updateSnapshot();
      },
    },
    {
      key: 't',
      description: `${color.bold('t')}  ${color.dim('filter by a test name regex pattern')}`,
      action: async () => {
        clearCurrentInputLine();
        await promptInput(
          'Enter test name pattern (empty to clear): ',
          async (pattern) => {
            await runWithTestNamePattern(pattern);
          },
        );
      },
    },
    {
      key: 'p',
      description: `${color.bold('p')}  ${color.dim('filter by a filename regex pattern')}`,
      action: async () => {
        clearCurrentInputLine();
        await promptInput(
          'Enter file name pattern (empty to clear): ',
          async (input) => {
            const filters = input
              ? input.split(/\s+/).filter(Boolean)
              : undefined;
            await runWithFileFilters(filters);
          },
        );
      },
    },
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
  ] as CliShortcut[];

  const handleKeypress = (
    str: string,
    key: { name: string; ctrl: boolean; meta: boolean; shift: boolean },
  ) => {
    if (isPrompting) return; // Ignore global shortcuts while prompting

    // Handle Ctrl+C
    if (key.ctrl && key.name === 'c') {
      process.exit(0);
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
    } catch {}
    process.stdin.off('keypress', handleKeypress);
    rl.close();
  };
}
