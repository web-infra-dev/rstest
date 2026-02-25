import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from '@rstest/core';
import treeKill from 'tree-kill';
import { prepareFixtures, runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const getHookCountFromLog = (content: string, hookName: string): number => {
  return content.split('\n').filter((line) => line.trim() === hookName).length;
};

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
        const timeoutMs = 15_000;
        const pollIntervalMs = 100;
        const startTime = Date.now();

        while (Date.now() - startTime < timeoutMs) {
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

      if (
        !cli.stdout.includes(
          'Watch mode enabled - will re-run tests on file changes',
        )
      ) {
        await cli.waitForStdout(
          'Watch mode enabled - will re-run tests on file changes',
        );
      }

      const testFilePath = path.join(fixturesTargetPath, 'tests/index.test.ts');

      cli.resetStd();
      fs.update(testFilePath, (content) => `${content}\n// watch-rerun-marker`);

      await cli.waitForStdout('Re-running 1 affected test file(s)');
      await waitForHookCounts(2, 2);
    } finally {
      const pid = cli.exec.process?.pid;
      if (pid) {
        treeKill(pid, 'SIGKILL');
      } else {
        cli.exec.kill();
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));

      try {
        fs.delete(fixturesTargetPath);
      } catch {
        // ignore cleanup errors in watch teardown
      }
    }
  }, 30_000);
});
