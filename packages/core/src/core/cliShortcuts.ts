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
}: {
  closeServer: () => Promise<void>;
}): Promise<() => void> {
  const shortcuts = [
    {
      key: 'c',
      description: `${color.bold('c + enter')}  ${color.dim('clear console')}`,
      action: () => {
        console.clear();
      },
    },
    {
      key: 'q',
      description: `${color.bold('q + enter')}  ${color.dim('quit process')}`,
      action: async () => {
        try {
          await closeServer();
        } finally {
          process.exit(0);
        }
      },
    },
  ];

  logger.log(
    `  ${color.dim('press')} ${color.bold('h')} ${color.dim('to show help')}${color.dim(', press')} ${color.bold('q')} ${color.dim('to quit')}\n`,
  );

  const { createInterface } = await import('node:readline');
  const rl = createInterface({
    input: process.stdin,
  });

  rl.on('line', (input) => {
    if (input === 'h') {
      let message = `\n  ${color.bold(color.blue('Shortcuts:'))}\n`;
      for (const shortcut of shortcuts) {
        message += `  ${shortcut.description}\n`;
      }
      logger.log(message);
    }

    for (const shortcut of shortcuts) {
      if (input === shortcut.key) {
        shortcut.action();
        return;
      }
    }
  });

  return () => {
    rl.close();
  };
}
