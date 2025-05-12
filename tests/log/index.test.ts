import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('console log', () => {
  it('should not console log when onConsoleLog return false', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'log.test', '-c', 'consoleLogFalse.config.ts'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await cli.exec;
    const logs = cli.stdout.split('\n').filter(Boolean);

    expect(logs.filter((log) => log.startsWith('I'))).toEqual([]);
  });
});
