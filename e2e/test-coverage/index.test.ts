import { join } from 'node:path';
import { describe, expect, it } from '@rstest/core';
import fs from 'fs-extra';
import { runRstestCli } from '../scripts';
import { type CoverageProvider, coverageProviders } from './providers';

const fixturePath = join(__dirname, 'fixtures');
const isCommonJs = process.env.RSTEST_OUTPUT_MODULE === 'false';

const coverageConfig = {
  istanbul: {
    enableConfig: 'rstest.enable.config.ts',
    skipFullConfig: 'rstest.skipFull.config.ts',
    stringSummary: 'string.ts|80.95|50|66.66|78.57|2-3,7',
    allFilesSummary: 'Allfiles|94.73|83.33|88.88|94.64|',
  },
  v8: {
    enableConfig: 'rstest.enable.v8.config.ts',
    skipFullConfig: 'rstest.skipFull.v8.config.ts',
    stringSummary: isCommonJs
      ? 'string.ts|81.25|50|66.66|78.57|3-6,10'
      : 'string.ts|75|50|66.66|78.57|2-3,7',
    allFilesSummary: isCommonJs
      ? 'Allfiles|95.08|76.92|88.88|94.64|'
      : 'Allfiles|93.44|84.61|88.88|94.64|',
  },
} satisfies Record<CoverageProvider, Record<string, string>>;

for (const provider of coverageProviders) {
  const { enableConfig, skipFullConfig, stringSummary, allFilesSummary } =
    coverageConfig[provider];

  describe(`coverage shared contract (${provider})`, () => {
    it('collects coverage and writes configured reports', async ({
      onTestFinished,
    }) => {
      const reportsDirectory = `test-temp-${provider}-basic-coverage`;
      const reportPath = join(fixturePath, reportsDirectory);
      onTestFinished(() => fs.removeSync(reportPath));

      const { expectExecSuccess, expectLog, cli } = await runRstestCli({
        command: 'rstest',
        args: [
          'run',
          '-c',
          enableConfig,
          '--coverage.reportsDirectory',
          reportsDirectory,
        ],
        options: {
          nodeOptions: {
            cwd: fixturePath,
          },
        },
      });

      await expectExecSuccess();

      const logs = cli.stdout.split('\n').filter(Boolean);

      expectLog(`Coverage enabled with ${provider}`, logs);
      expect(
        logs.find(
          (log) =>
            log.includes('index.test.ts') &&
            log.includes('|') &&
            log.replaceAll(' ', '').includes('100|100|100|100'),
        ),
      ).toBeFalsy();
      expect(
        logs.find(
          (log) =>
            log.includes('rstest.setup.ts') &&
            log.includes('|') &&
            log.replaceAll(' ', '').includes('100|100|100|100'),
        ),
      ).toBeFalsy();
      expect(
        logs.find(
          (log) =>
            log.includes('index.ts') &&
            log.includes('|') &&
            log.replaceAll(' ', '').includes('100|100|100|100'),
        ),
      ).toBeTruthy();
      expect(
        logs
          .find((log) => log.includes('string.ts') && log.includes('|'))
          ?.replaceAll(' ', ''),
      ).toBe(stringSummary);
      expect(
        logs.find((log) => log.includes('All files'))?.replaceAll(' ', ''),
      ).toBe(allFilesSummary);

      expectLog('% Stmts', logs);
      expect(fs.existsSync(join(reportPath, 'index.html'))).toBeTruthy();
      expect(fs.existsSync(join(reportPath, 'clover.xml'))).toBeTruthy();
      expect(
        fs.existsSync(join(reportPath, 'coverage-final.json')),
      ).toBeTruthy();
    });

    it('omits fully covered files with skipFull', async ({
      onTestFinished,
    }) => {
      const reportsDirectory = `test-temp-${provider}-skip-full-coverage`;
      const reportPath = join(fixturePath, reportsDirectory);
      onTestFinished(() => fs.removeSync(reportPath));

      const { expectExecSuccess, expectLog, cli } = await runRstestCli({
        command: 'rstest',
        args: [
          'run',
          '-c',
          skipFullConfig,
          '--coverage.reportsDirectory',
          reportsDirectory,
        ],
        options: {
          nodeOptions: {
            cwd: fixturePath,
          },
        },
      });

      await expectExecSuccess();

      const logs = cli.stdout.split('\n').filter(Boolean);

      expectLog(`Coverage enabled with ${provider}`, logs);
      expect(
        logs.find((log) => log.includes('index.ts') && log.includes('|')),
      ).toBeFalsy();
      expect(
        logs
          .find((log) => log.includes('string.ts') && log.includes('|'))
          ?.replaceAll(' ', ''),
      ).toBe(stringSummary);
      expectLog('% Stmts', logs);
      expect(fs.existsSync(join(reportPath, 'index.html'))).toBeFalsy();
    });

    it('writes reports to a custom directory', async ({ onTestFinished }) => {
      const reportPath = join(fixturePath, 'test-temp-coverage');
      onTestFinished(() => fs.removeSync(reportPath));

      const { expectExecSuccess, expectLog, cli } = await runRstestCli({
        command: 'rstest',
        args: [
          'run',
          '-c',
          'rstest.reportsDirectory.config.ts',
          '--coverage.provider',
          provider,
        ],
        options: {
          nodeOptions: {
            cwd: fixturePath,
          },
        },
      });

      await expectExecSuccess();

      const logs = cli.stdout.split('\n').filter(Boolean);

      expectLog(`Coverage enabled with ${provider}`, logs);
      expect(fs.existsSync(join(reportPath, 'index.html'))).toBeTruthy();
    });

    it('reports zero coverage when include matches no source files', async ({
      onTestFinished,
    }) => {
      const reportsDirectory = `test-temp-${provider}-empty-coverage`;
      const reportPath = join(fixturePath, reportsDirectory);
      onTestFinished(() => fs.removeSync(reportPath));

      const { expectExecSuccess, expectLog, cli } = await runRstestCli({
        command: 'rstest',
        args: [
          'run',
          '-c',
          'rstest.noCoverageFiles.config.ts',
          '--coverage.provider',
          provider,
          '--coverage.reportsDirectory',
          reportsDirectory,
        ],
        options: {
          nodeOptions: {
            cwd: fixturePath,
          },
        },
      });

      await expectExecSuccess();

      const logs = cli.stdout.split('\n').filter(Boolean);

      expectLog(`Coverage enabled with ${provider}`, logs);
      expect(
        logs.find((log) => log.includes('All files'))?.replaceAll(' ', ''),
      ).toBe('Allfiles|0|0|0|0|');
    });
  });
}
