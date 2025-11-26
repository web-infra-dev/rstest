import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts/';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('test bail option', () => {
  it('should not run all tests when `--bail <number>`', async () => {
    const { expectExecFailed, cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/index.test.ts', '--bail', '1'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await expectExecFailed();

    const logs = cli.stdout.split('\n').filter((log) => log.includes('Tests'));
    // `Tests 1 failed | 1 passed (2)` => 2
    const totalCount = Number(logs[0]!.match(/\((\d+)\)/)?.[1]);
    expect(totalCount).toBe(2);
  });

  it('should not run all tests when `--bail` (default 1)', async () => {
    const { expectExecFailed, cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/index.test.ts', '--bail'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await expectExecFailed();

    const logs = cli.stdout.split('\n').filter((log) => log.includes('Tests'));
    // `Tests 1 failed | 1 passed (2)` => 2
    const totalCount = Number(logs[0]!.match(/\((\d+)\)/)?.[1]);
    expect(totalCount).toBe(2);
  });

  it('should run all tests when `--bail 0`', async () => {
    const { expectExecFailed, cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/index.test.ts', '--bail', '0'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await expectExecFailed();

    const logs = cli.stdout.split('\n').filter((log) => log.includes('Tests'));
    // `Tests 1 failed | 2 passed (3)` => 3
    const totalCount = Number(logs[0]!.match(/\((\d+)\)/)?.[1]);
    expect(totalCount).toBe(3);
  });
});
