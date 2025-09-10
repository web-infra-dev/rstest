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

  it('should onConsoleLog will not take effect when disableConsoleIntercept', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        'log.test',
        '-c',
        'consoleLogFalse.config.ts',
        '--disableConsoleIntercept',
      ],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await cli.exec;
    const logs = cli.stdout.split('\n').filter(Boolean);

    expect(logs.some((log) => log.startsWith('I'))).toBeTruthy();
    expect(logs.some((log) => log.includes('log.test.ts:4:11'))).toBeFalsy();
  });
});
