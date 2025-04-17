import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('test describe API', () => {
  it('should skip test when describe skipped', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'skip.test'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await cli.exec;
    const logs = cli.stdout.split('\n').filter(Boolean);

    expect(logs.filter((log) => log.startsWith('['))).toEqual([]);

    // test log print
    expect(
      logs.find((log) => log.includes('Test Files 1 skipped')),
    ).toBeTruthy();
    expect(logs.find((log) => log.includes('Tests 2 skipped'))).toBeTruthy();
  });

  it('should skip test when describe todo', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'todo.test'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await cli.exec;
    const logs = cli.stdout.split('\n').filter(Boolean);

    expect(logs.filter((log) => log.startsWith('['))).toEqual([]);

    // test log print
    expect(logs.find((log) => log.includes('Test Files 1 todo'))).toBeTruthy();
    expect(logs.find((log) => log.includes('Tests 2 todo'))).toBeTruthy();
  });
});
