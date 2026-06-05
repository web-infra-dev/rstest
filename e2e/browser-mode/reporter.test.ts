import { describe, expect, it } from '@rstest/core';
import { runBrowserCli } from './utils';

const getHookCount = (output: string, hookName: string): number => {
  return (
    output.match(new RegExp(`\\[browser reporter\\] ${hookName}`, 'g'))
      ?.length ?? 0
  );
};

describe('browser mode - reporter lifecycle hooks', () => {
  it('should call browser reporter lifecycle hooks with project filter', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli('reporter', {
      args: ['--project', 'browser'],
    });

    await expectExecSuccess();

    expect(getHookCount(cli.stdout, 'onTestRunStart')).toBe(1);
    expect(getHookCount(cli.stdout, 'onTestFileReady')).toBe(1);
    expect(getHookCount(cli.stdout, 'onTestSuiteStart')).toBe(1);
    expect(getHookCount(cli.stdout, 'onTestCaseStart')).toBe(1);
    expect(getHookCount(cli.stdout, 'onTestSuiteResult')).toBe(1);
    expect(getHookCount(cli.stdout, 'onTestRunEnd')).toBe(1);
  });

  it('should expand every case for a single-file browser run (showAllCases aligned with node)', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli('browser-verbose');

    await expectExecSuccess();

    // A single-file browser-only run now populates `stateManager.testFiles`, so
    // the verbose reporter expands all cases — including passing ones — exactly
    // like a single-file node run (RFC phase 3). Before this alignment, passing
    // cases were collapsed because `getTestFiles()` was undefined for browser.
    expect(cli.stdout).toContain('alpha case passes');
    expect(cli.stdout).toContain('beta case passes');
    expect(cli.stdout).toContain('gamma case passes');
  });
});
