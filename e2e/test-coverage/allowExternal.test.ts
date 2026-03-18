import { join } from 'node:path';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

describe('test coverage allowExternal option', () => {
  it('should exclude external files by default (allowExternal: false)', async () => {
    const { expectExecSuccess, cli } = await runRstestCli({
      command: 'rstest',
      args: ['run'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures/allow-external'),
        },
      },
    });

    await expectExecSuccess();

    const logs = cli.stdout.split('\n').filter(Boolean);

    // internal file should be in coverage
    expect(
      logs.find((log) => log.includes('internal.ts') && log.includes('|')),
    ).toBeTruthy();

    // external file (helper.ts) should NOT be in coverage
    expect(
      logs.find((log) => log.includes('helper.ts') && log.includes('|')),
    ).toBeFalsy();
  });

  it('should include external files when allowExternal is true', async () => {
    const { expectExecSuccess, cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--coverage.allowExternal'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures/allow-external'),
        },
      },
    });

    await expectExecSuccess();

    const logs = cli.stdout.split('\n').filter(Boolean);

    // internal file should be in coverage
    expect(
      logs.find((log) => log.includes('internal.ts') && log.includes('|')),
    ).toBeTruthy();

    // external file (helper.ts) SHOULD be in coverage
    expect(
      logs.find((log) => log.includes('helper.ts') && log.includes('|')),
    ).toBeTruthy();
  });
});
