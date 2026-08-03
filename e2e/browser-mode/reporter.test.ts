import { describe, expect, it } from '@rstest/core';
import { runBrowserCli, shouldRunHeadedBrowserTests } from './utils';

const getHookCount = (output: string, hookName: string): number => {
  return (
    output.match(new RegExp(`\\[browser reporter\\] ${hookName}`, 'g'))
      ?.length ?? 0
  );
};

describe('browser mode - reporter lifecycle hooks', () => {
  it('should call browser reporter lifecycle hooks with project filter', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli('reporter', {
      args: ['--project', 'browser', 'tests/browser/lifecycle.test.ts'],
    });

    await expectExecSuccess();

    expect(getHookCount(cli.stdout, 'onTestRunStart')).toBe(1);
    expect(getHookCount(cli.stdout, 'onTestFileReady')).toBe(1);
    expect(getHookCount(cli.stdout, 'onTestSuiteStart')).toBe(1);
    expect(getHookCount(cli.stdout, 'onTestCaseStart')).toBe(1);
    expect(getHookCount(cli.stdout, 'onTestSuiteResult')).toBe(1);
    expect(getHookCount(cli.stdout, 'onTestFileResult')).toBe(1);
    expect(getHookCount(cli.stdout, 'onTestRunEnd')).toBe(1);
  });

  it('should finish worker cleanup before awaiting reporters', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli('reporter', {
      args: ['--project', 'browser', 'tests/browser/lifecycle.test.ts'],
      env: { RSTEST_REPORTER_DELAY: '10100' },
    });

    await expectExecSuccess();
    expect(getHookCount(cli.stdout, 'onTestFileResult')).toBe(1);
    expect(getHookCount(cli.stdout, 'onTestRunEnd')).toBe(1);
  });

  it('should await reporters before surfacing worker cleanup failures', async () => {
    const { expectExecFailed, cli } = await runBrowserCli('reporter', {
      args: ['--project', 'browser', 'tests/browser/cleanupFailure.test.ts'],
    });

    await expectExecFailed();
    expect(`${cli.stdout}\n${cli.stderr}`).toContain(
      'reporter worker cleanup failed',
    );
    expect(getHookCount(cli.stdout, 'onTestFileResult')).toBe(1);
    expect(getHookCount(cli.stdout, 'onTestRunEnd')).toBe(1);
  });

  it.runIf(shouldRunHeadedBrowserTests)(
    'should await reporters before surfacing worker cleanup failures in headed mode',
    async () => {
      const { expectExecFailed, cli } = await runBrowserCli('reporter', {
        args: [
          '--project',
          'browser',
          '--browser.headless',
          'false',
          'tests/browser/cleanupFailure.test.ts',
        ],
      });

      await expectExecFailed();
      expect(`${cli.stdout}\n${cli.stderr}`).toContain(
        'reporter worker cleanup failed',
      );
      expect(getHookCount(cli.stdout, 'onTestFileResult')).toBe(1);
      expect(getHookCount(cli.stdout, 'onTestRunEnd')).toBe(1);
    },
  );

  it.runIf(shouldRunHeadedBrowserTests)(
    'should finish worker cleanup before awaiting reporters in headed mode',
    async () => {
      const { expectExecSuccess, cli } = await runBrowserCli('reporter', {
        args: [
          '--project',
          'browser',
          '--browser.headless',
          'false',
          'tests/browser/lifecycle.test.ts',
        ],
        env: { RSTEST_REPORTER_DELAY: '10100' },
      });

      await expectExecSuccess();
      expect(getHookCount(cli.stdout, 'onTestFileResult')).toBe(1);
      expect(getHookCount(cli.stdout, 'onTestRunEnd')).toBe(1);
    },
  );
});
