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

  it('should allow skip / todo function undefined', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'undefined.test'],
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
    expect(logs.find((log) => log.includes('Tests no tests'))).toBeTruthy();
  });

  it('should throw error when nest describe / test inside a test', async () => {
    const { cli, expectLog } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'nested.test'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await cli.exec;
    expect(cli.exec.process?.exitCode).toBe(1);

    const logs = cli.stdout.split('\n').filter(Boolean);

    expectLog('Tests 2 failed | 1 passed', logs);
    expectLog(
      "Describe '3' cannot run because it is nested within test '2'",
      logs,
    );
    expectLog("Test '6' cannot run because it is nested within test '5'", logs);
  });
});
