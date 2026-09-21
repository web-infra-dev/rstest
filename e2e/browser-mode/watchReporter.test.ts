import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, type TestRunStartPayload } from '@rstest/core';
import { normalize } from 'pathe';
import { prepareFixtures } from '../scripts';
import {
  deleteFixtureTarget,
  killCliProcessTree,
  runBrowserWatchCliWithCwd,
} from './utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const getHookCountFromLog = (content: string, hookName: string): number => {
  return content.split('\n').filter((line) => line.trim() === hookName).length;
};

// Real Chrome (channel=chrome) cold-launch on loaded CI runners can push the
// first run past a tight budget, so keep this generous across platforms.
const WATCH_REPORTER_HOOK_TIMEOUT_MS = 15_000;

describe('browser mode - watch reporter lifecycle', () => {
  it.for([true, false])(
    'reports the selected watch subset (browser: %s)',
    async (browser) => {
      const fixturesTargetPath = `${__dirname}/fixtures/fixtures-test-browser-watch-reporter`;

      const { fs } = await prepareFixtures({
        fixturesPath: `${__dirname}/fixtures/reporter-watch`,
        fixturesTargetPath,
      });
      const reportLogPath = path.join(fixturesTargetPath, 'watch-reporter.log');
      fs.create(
        path.join(fixturesTargetPath, 'tests/other.test.ts'),
        "import { test } from '@rstest/core'; test('other', () => {});",
      );

      const { cli } = await runBrowserWatchCliWithCwd(fixturesTargetPath, {
        args: browser ? [] : ['--browser.enabled=false'],
      });
      const selections = (log: string): TestRunStartPayload[] =>
        log
          .split('\n')
          .filter((line) => line.startsWith('{'))
          .map((line) => JSON.parse(line));

      try {
        const waitForHookCounts = async (
          expectedStartCount: number,
          expectedEndCount: number,
        ): Promise<void> => {
          const pollIntervalMs = 25;
          const startTime = Date.now();

          while (Date.now() - startTime < WATCH_REPORTER_HOOK_TIMEOUT_MS) {
            let reportLog: string;
            try {
              reportLog = fs.read(reportLogPath);
            } catch {
              reportLog = '';
            }

            const startCount = getHookCountFromLog(reportLog, 'onTestRunStart');
            const endCount = getHookCountFromLog(reportLog, 'onTestRunEnd');

            if (
              startCount >= expectedStartCount &&
              endCount >= expectedEndCount
            ) {
              return;
            }

            await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
          }

          throw new Error(
            `Timed out waiting for hooks start=${expectedStartCount}, end=${expectedEndCount}. Current log:\n${fs.read(reportLogPath)}`,
          );
        };

        await waitForHookCounts(1, 1);

        if (!cli.stdout.includes('Waiting for file changes...')) {
          await cli.waitForStdout('Waiting for file changes...');
        }

        const initialReportLog = fs.read(reportLogPath);
        expect(getHookCountFromLog(initialReportLog, 'onTestRunStart')).toBe(1);
        expect(getHookCountFromLog(initialReportLog, 'onTestRunEnd')).toBe(1);
        expect(
          selections(initialReportLog)[0]!
            .files.map((file) => path.basename(file.testPath))
            .sort(),
        ).toEqual(['index.test.ts', 'other.test.ts']);

        const testFilePath = path.join(
          fixturesTargetPath,
          'tests/index.test.ts',
        );

        cli.resetStd();
        fs.update(
          testFilePath,
          (content) => `${content}\n// watch-rerun-marker`,
        );

        if (browser)
          await cli.waitForStdout('Re-running 1 affected test file(s)');
        await waitForHookCounts(2, 2);

        if (!cli.stdout.includes('Waiting for file changes...')) {
          await cli.waitForStdout('Waiting for file changes...');
        }

        const rerunReportLog = fs.read(reportLogPath);
        expect(getHookCountFromLog(rerunReportLog, 'onTestRunStart')).toBe(2);
        expect(getHookCountFromLog(rerunReportLog, 'onTestRunEnd')).toBe(2);
        const rerunFiles = selections(rerunReportLog)[1]!.files;
        expect(rerunFiles).toHaveLength(1);
        expect(rerunFiles[0]).toEqual({
          testPath: normalize(testFilePath),
          testId: `file:${normalize(testFilePath)}`,
          project: selections(initialReportLog)[0]!.files[0]!.project,
        });
      } finally {
        await killCliProcessTree(cli);
        await deleteFixtureTarget(fs, fixturesTargetPath);
      }
    },
    30_000,
  );
});
