import { describe, expect, it } from '@rstest/core';
import { runBrowserCli } from './utils';

describe('browser mode - console forwarding', () => {
  it('should forward all console methods to terminal', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli('console');

    await expectExecSuccess();

    // Verify all tests passed
    expect(cli.stdout).toMatch(/Tests.*8 passed/);

    // Verify console.log forwarding
    expect(cli.stdout).toContain('CONSOLE_LOG_TEST_MESSAGE');

    // Verify console.info forwarding
    expect(cli.stdout).toContain('CONSOLE_INFO_TEST_MESSAGE');

    // Verify console.warn forwarding
    expect(cli.stderr).toContain('CONSOLE_WARN_TEST_MESSAGE');

    // Verify console.error forwarding
    expect(cli.stderr).toContain('CONSOLE_ERROR_TEST_MESSAGE');

    // Verify console.debug forwarding
    expect(cli.stdout).toContain('CONSOLE_DEBUG_TEST_MESSAGE');

    // Verify multiple arguments are joined with space
    expect(cli.stdout).toContain('MULTI_ARG_TEST arg1 arg2 123');

    // Verify object arguments are formatted as JSON
    expect(cli.stdout).toContain('OBJECT_TEST');
    expect(cli.stdout).toContain('"key": "value"');

    // Verify array arguments are formatted as JSON
    expect(cli.stdout).toContain('ARRAY_TEST');
    expect(cli.stdout).toMatch(
      /\[[\s\S]*1[\s\S]*2[\s\S]*3[\s\S]*"four"[\s\S]*\]/,
    );

    // Verify log level prefix and test file path are displayed
    expect(cli.stdout).toMatch(/log.*\|.*tests\/console\.test\.ts/);
    expect(cli.stdout).toMatch(/info.*\|.*tests\/console\.test\.ts/);
    expect(cli.stderr).toMatch(/warn.*\|.*tests\/console\.test\.ts/);
    expect(cli.stderr).toMatch(/error.*\|.*tests\/console\.test\.ts/);
    expect(cli.stdout).toMatch(/debug.*\|.*tests\/console\.test\.ts/);
  });

  it('should only replay failed task logs with silent=passed-only', async () => {
    const { cli } = await runBrowserCli('silent', {
      args: ['--silent=passed-only'],
    });

    await cli.exec;

    expect(cli.stdout).toContain('BROWSER_FILE_LEVEL_LOG');
    expect(cli.stdout).toContain('BROWSER_FAILING_SUITE_LOG');
    expect(cli.stdout).toContain('BROWSER_FAILING_CASE_LOG');
    expect(cli.stdout).not.toContain('BROWSER_PASSING_SUITE_LOG');
    expect(cli.stdout).not.toContain('BROWSER_PASSING_CASE_LOG');
  });

  it('should not forward browser console logs when console intercept is disabled', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli('console', {
      args: ['--disableConsoleIntercept'],
    });

    await expectExecSuccess();

    expect(cli.stdout).not.toContain('CONSOLE_LOG_TEST_MESSAGE');
    expect(cli.stdout).not.toContain('CONSOLE_INFO_TEST_MESSAGE');
    expect(cli.stdout).not.toContain('CONSOLE_DEBUG_TEST_MESSAGE');
    expect(cli.stderr).not.toContain('CONSOLE_WARN_TEST_MESSAGE');
    expect(cli.stderr).not.toContain('CONSOLE_ERROR_TEST_MESSAGE');
  });

  it('should still replay failed task logs when silent=passed-only and console intercept is disabled', async () => {
    const { cli } = await runBrowserCli('silent', {
      args: ['--silent=passed-only', '--disableConsoleIntercept'],
    });

    await cli.exec;

    expect(cli.stdout).toContain('BROWSER_FILE_LEVEL_LOG');
    expect(cli.stdout).toContain('BROWSER_FAILING_SUITE_LOG');
    expect(cli.stdout).toContain('BROWSER_FAILING_CASE_LOG');
    expect(cli.stdout).not.toContain('BROWSER_PASSING_SUITE_LOG');
    expect(cli.stdout).not.toContain('BROWSER_PASSING_CASE_LOG');
  });

  it('should ignore onConsoleLog when silent=passed-only and console intercept is disabled', async () => {
    const { cli } = await runBrowserCli('silent', {
      args: [
        '--silent=passed-only',
        '--disableConsoleIntercept',
        '-c',
        'rstest.onConsoleLogFalse.config.mts',
      ],
    });

    await cli.exec;

    expect(cli.stdout).toContain('BROWSER_FILE_LEVEL_LOG');
    expect(cli.stdout).toContain('BROWSER_FAILING_SUITE_LOG');
    expect(cli.stdout).toContain('BROWSER_FAILING_CASE_LOG');
    expect(cli.stdout).not.toContain('BROWSER_PASSING_SUITE_LOG');
    expect(cli.stdout).not.toContain('BROWSER_PASSING_CASE_LOG');
  });
});
