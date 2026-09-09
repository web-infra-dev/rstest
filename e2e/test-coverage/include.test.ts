import { join } from 'node:path';
import { describe, expect, it } from '@rstest/core';
import fs from 'fs-extra';
import { getCoverageSummaryEntry, runRstestCli } from '../scripts';
import { coverageProviders } from './providers';

const configByProvider = {
  istanbul: 'rstest.include.config.ts',
  v8: 'rstest.include.v8.config.ts',
} as const;

for (const provider of coverageProviders) {
  describe(`coverage include (${provider})`, () => {
    it('includes and excludes configured source files', async ({
      onTestFinished,
    }) => {
      const reportsDirectory = `test-temp-${provider}-include-coverage`;
      const reportPath = join(__dirname, 'fixtures', reportsDirectory);
      onTestFinished(() => fs.removeSync(reportPath));

      const { expectExecSuccess, expectLog, cli } = await runRstestCli({
        command: 'rstest',
        args: [
          'run',
          'date',
          '-c',
          configByProvider[provider],
          '--pool',
          'vmThreads',
          '--pool.memoryLimit',
          '256MB',
          '--coverage.reportsDirectory',
          reportsDirectory,
        ],
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

      expect(
        logs.find((log) => log.includes('a.ts') && log.includes('|')),
      ).toBeFalsy();

      expect(
        logs.find((log) => log.includes('b.ts') && log.includes('|')),
      ).toBeFalsy();

      expect(
        logs.find((log) => log.includes('c.ts') && log.includes('|')),
      ).toBeFalsy();

      const coverageSummary: Record<
        string,
        Record<string, { total: number; covered: number }>
      > = fs.readJsonSync(join(reportPath, 'coverage-summary.json'));
      expect(
        getCoverageSummaryEntry(
          coverageSummary,
          join(__dirname, 'fixtures/src/untested.jsx'),
        ),
      ).toMatchObject({
        lines: { covered: 0 },
        statements: { covered: 0 },
        functions: { covered: 0 },
        branches: { covered: 0 },
      });

      if (provider === 'v8') {
        const sourcePath = join(__dirname, 'fixtures/v8/include/src');

        expect(
          getCoverageSummaryEntry(
            coverageSummary,
            join(sourcePath, 'types-only.ts'),
          ),
        ).toMatchObject({
          lines: { total: 0, covered: 0 },
          statements: { total: 0, covered: 0 },
          functions: { total: 0, covered: 0 },
          branches: { total: 0, covered: 0 },
        });
        expect(
          getCoverageSummaryEntry(
            coverageSummary,
            join(sourcePath, 'uncovered-mixed.ts'),
          ),
        ).toMatchObject({
          lines: { total: 1, covered: 0 },
          statements: { total: 1, covered: 0 },
          functions: { total: 1, covered: 0 },
          branches: { total: 0, covered: 0 },
        });
        expect(
          getCoverageSummaryEntry(
            coverageSummary,
            join(sourcePath, 'type-assertion.ts'),
          ),
        ).toMatchObject({
          lines: { total: 1, covered: 0 },
          statements: { total: 1, covered: 0 },
          functions: { total: 1, covered: 0 },
          branches: { total: 0, covered: 0 },
        });
      }

      expectLog('Test Files 1 passed', logs);
    });
  });
}
