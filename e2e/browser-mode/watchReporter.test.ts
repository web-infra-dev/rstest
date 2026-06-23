import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from '@rstest/core';
import { prepareFixtures, runRstestCli } from '../scripts';
import { deleteFixtureTarget, killCliProcessTree } from './utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const getHookCountFromLog = (content: string, hookName: string): number => {
  return content.split('\n').filter((line) => line.trim() === hookName).length;
};

const WATCH_REPORTER_HOOK_TIMEOUT_MS =
  process.platform === 'win32' ? 15_000 : 5_000;

describe('browser mode - watch reporter lifecycle', () => {
  it('should call onTestRunStart and onTestRunEnd on rerun', async () => {
    const fixturesTargetPath = `${__dirname}/fixtures/fixtures-test-browser-watch-reporter`;

    const { fs } = await prepareFixtures({
      fixturesPath: `${__dirname}/fixtures/reporter-watch`,
      fixturesTargetPath,
    });
    const reportLogPath = path.join(fixturesTargetPath, 'watch-reporter.log');

    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['watch', '--disableConsoleIntercept'],
      options: {
        nodeOptions: {
          env: { DEBUG: 'rstest' },
          cwd: fixturesTargetPath,
        },
      },
    });

    try {
      const waitForHookCounts = async (
        expectedStartCount: number,
        expectedEndCount: number,
      ): Promise<void> => {
        const pollIntervalMs = 25;
        const startTime = Date.now();

        while (Date.now() - startTime < WATCH_REPORTER_HOOK_TIMEOUT_MS) {
          let reportLog = '';
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

      const testFilePath = path.join(fixturesTargetPath, 'tests/index.test.ts');

      cli.resetStd();
      fs.update(testFilePath, (content) => `${content}\n// watch-rerun-marker`);

      await cli.waitForStdout('Re-running 1 affected test file(s)');
      await waitForHookCounts(2, 2);
    } finally {
      await killCliProcessTree(cli);
      await deleteFixtureTarget(fs, fixturesTargetPath);
    }
  }, 30_000);
});
