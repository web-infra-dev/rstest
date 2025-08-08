import { color, isTTY, logger } from '../utils';

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
}: {
  runFailedTests: () => Promise<void>;
  closeServer: () => Promise<void>;
  runAll: () => Promise<void>;
  updateSnapshot: () => Promise<void>;
}): Promise<() => void> {
  const shortcuts = [
    {
      key: 'c',
      description: `${color.bold('c')}  ${color.dim('clear console')}`,
      action: () => {
        console.clear();
      },
    },
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
  ];

  const { createInterface } = await import('node:readline');
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // Set raw mode to capture individual keystrokes
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  const handleKeypress = (
    str: string,
    key: { name: string; ctrl: boolean; meta: boolean; shift: boolean },
  ) => {
    // Handle Ctrl+C
    if (key.ctrl && key.name === 'c') {
      process.exit(0);
    }

    // Check shortcuts
    for (const shortcut of shortcuts) {
      if (str === shortcut.key) {
        shortcut.action();
        return;
      }
    }

    // Show help information
    if (str === 'h') {
      let message = `\n  ${color.bold(color.blue('Shortcuts:'))}\n`;
      for (const shortcut of shortcuts) {
        message += `  ${shortcut.description}\n`;
      }
      logger.log(message);
    }
  };

  process.stdin.on('keypress', handleKeypress);

  return () => {
    process.stdin.setRawMode(false);
    process.stdin.pause();
    rl.close();
  };
}
