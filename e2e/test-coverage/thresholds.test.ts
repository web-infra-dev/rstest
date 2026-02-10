import { join } from 'node:path';
import { describe, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

describe('coverageThresholds', () => {
  it('should check global threshold correctly', async () => {
    const { expectStderrLog, expectExecFailed } = await runRstestCli({
      command: 'rstest',
      args: ['run', '-c', 'rstest.thresholds.config.ts'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecFailed();

    expectStderrLog(
      /Coverage for statements .* does not meet global threshold/i,
    );

    expectStderrLog(
      /Uncovered lines .* exceeds maximum global threshold allowed/i,
    );
  });

  it('should check glob threshold correctly', async () => {
    const { expectStderrLog, expectExecFailed } = await runRstestCli({
      command: 'rstest',
      args: ['run', '-c', 'rstest.globThresholds.config.ts'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecFailed();

    expectStderrLog(
      /Error: coverage for statements .* does not meet "src\/\*\*" threshold/i,
    );

    expectStderrLog(/Coverage data for "node\/\*\*" was not found/i);
  });

  it('should check per files threshold correctly', async () => {
    const { expectStderrLog, expectExecFailed } = await runRstestCli({
      command: 'rstest',
      args: ['run', '-c', 'rstest.perFileThresholds.config.ts'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecFailed();

    expectStderrLog(
      /src\/string.ts coverage for statements .* does not meet "src\/\*\*" threshold/,
    );
  });
});
