import { join } from 'node:path';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

describe('test coverage-istanbul include option', () => {
  it('coverage-istanbul should be works with include option', async () => {
    const { expectExecSuccess, expectLog, cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'date', '-c', 'rstest.include.config.ts'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecSuccess();

    const logs = cli.stdout.split('\n').filter(Boolean);
    // test coverage
    expect(
      logs
        .find((log) => log.includes('index.ts') && log.includes('|'))
        ?.replaceAll(' ', ''),
    ).toMatchInlineSnapshot(`"index.ts|0|100|0|0|1"`);
    expect(
      logs
        .find((log) => log.includes('date.ts') && log.includes('|'))
        ?.replaceAll(' ', ''),
    ).toMatchInlineSnapshot(`"date.ts|100|100|100|100|"`);

    expectLog('Test Files 1 passed', logs);
  });
});
