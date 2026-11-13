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

describe('browser mode - watch reporter lifecycle', () => {
  it('reports the selected browser watch subset', async () => {
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

    const { cli } = await runBrowserWatchCliWithCwd(fixturesTargetPath);
    const selections = (log: string): TestRunStartPayload[] =>
      log
        .split('\n')
        .filter((line) => line.startsWith('{'))
        .map((line) => JSON.parse(line));

    try {
      await cli.waitForStdout('WATCH_REPORTER_RUN_END:1');
      await cli.waitForStdout('Waiting for file changes...');

      const initialReportLog = fs.read(reportLogPath);
      expect(getHookCountFromLog(initialReportLog, 'onTestRunStart')).toBe(1);
      expect(getHookCountFromLog(initialReportLog, 'onTestRunEnd')).toBe(1);
      expect(
        selections(initialReportLog)[0]!
          .files.map((file) => path.basename(file.testPath))
          .sort(),
      ).toEqual(['index.test.ts', 'other.test.ts']);

      const testFilePath = path.join(fixturesTargetPath, 'tests/index.test.ts');

      cli.resetStd();
      // A comment-only edit can leave the emitted module unchanged.
      fs.update(testFilePath, (content) =>
        content.replace("'should pass'", "'should pass after edit'"),
      );

      await cli.waitForStdout('WATCH_REPORTER_RUN_END:2');
      await cli.waitForStdout('Waiting for file changes...');
      expect(cli.stdout).toContain('Re-running 1 affected test file(s)');

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
  }, 30_000);
});
