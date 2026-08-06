import { join } from 'node:path';
import { describe, it } from '@rstest/core';
import { runRstestCli } from '../scripts';
import { coverageProviders } from './providers';

for (const provider of coverageProviders) {
  describe(`coverage thresholds (${provider})`, () => {
    it('checks global thresholds', async () => {
      const { expectStderrLog, expectExecFailed } = await runRstestCli({
        command: 'rstest',
        args: [
          'run',
          '-c',
          'rstest.thresholds.config.ts',
          '--coverage.provider',
          provider,
        ],
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

    it('checks glob thresholds', async () => {
      const { expectStderrLog, expectExecFailed } = await runRstestCli({
        command: 'rstest',
        args: [
          'run',
          '-c',
          'rstest.globThresholds.config.ts',
          '--coverage.provider',
          provider,
        ],
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

    it('checks per-file thresholds', async () => {
      const { expectStderrLog, expectExecFailed } = await runRstestCli({
        command: 'rstest',
        args: [
          'run',
          '-c',
          'rstest.perFileThresholds.config.ts',
          '--coverage.provider',
          provider,
        ],
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
}
