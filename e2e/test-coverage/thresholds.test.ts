import { join } from 'node:path';
import { describe, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

describe('coverageThresholds', () => {
  it('should check global threshold correctly', async () => {
    const { expectLog, cli, expectExecFailed } = await runRstestCli({
      command: 'rstest',
      args: ['run', '-c', 'rstest.thresholds.config.ts'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecFailed();

    const logs = cli.stdout.split('\n').filter(Boolean);

    expectLog(
      /Coverage for statements .* does not meet global threshold/i,
      logs,
    );

    expectLog(
      /Uncovered lines .* exceeds maximum global threshold allowed/i,
      logs,
    );
  });

  it('should check glob threshold correctly', async () => {
    const { expectLog, expectExecFailed, cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', '-c', 'rstest.globThresholds.config.ts'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecFailed();

    const logs = cli.stdout.split('\n').filter(Boolean);

    expectLog(
      /Error: coverage for statements .* does not meet "src\/\*\*" threshold/i,
      logs,
    );

    expectLog(/Coverage data for "node\/\*\*" was not found/i, logs);
  });

  it('should check per files threshold correctly', async () => {
    const { expectLog, expectExecFailed, cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', '-c', 'rstest.perFileThresholds.config.ts'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecFailed();

    const logs = cli.stdout.split('\n').filter(Boolean);

    expectLog(
      /src\/string.ts coverage for statements .* does not meet "src\/\*\*" threshold/,
      logs,
    );
  });
});
