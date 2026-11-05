import { join } from 'node:path';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';
import { coverageProviders } from './providers';

for (const provider of coverageProviders) {
  describe(`coverage thresholds (${provider})`, () => {
    it('checks global thresholds', async () => {
      const { cli, expectStderrLog, expectExecFailed } = await runRstestCli({
        command: 'rstest',
        args: [
          'run',
          '-c',
          'rstest.thresholds.config.ts',
          '--pool',
          'vmThreads',
          '--pool.memoryLimit',
          '256MB',
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

      expect(cli.exec.process?.exitCode).toBe(1);
      expect(cli.stdout).toContain('RUN_END_STATUS:failed:FAILED_TESTS:0');
      // Both the JSON and Markdown summaries must use the final host verdict.
      expect(cli.stdout.match(/"status": "failed"/g)).toHaveLength(2);

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
          '--pool',
          'vmThreads',
          '--pool.memoryLimit',
          '256MB',
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
          '--pool',
          'vmThreads',
          '--pool.memoryLimit',
          '256MB',
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
