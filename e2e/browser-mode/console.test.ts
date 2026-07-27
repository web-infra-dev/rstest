import { describe, expect, it } from '@rstest/core';
import { runBrowserCli } from './utils';

describe('browser mode - console forwarding', () => {
  it.for([
    { disableConsoleIntercept: false },
    { disableConsoleIntercept: true },
  ])(
    'should handle console forwarding with disableConsoleIntercept=$disableConsoleIntercept',
    async ({ disableConsoleIntercept }) => {
      const { expectExecSuccess, cli } = await runBrowserCli('console', {
        args: disableConsoleIntercept ? ['--disableConsoleIntercept'] : [],
      });

      await expectExecSuccess();

      // Verify all tests passed
      expect(cli.stdout).toMatch(/Tests.*9 passed/);

      if (disableConsoleIntercept) {
        expect(cli.stdout).not.toContain('CONSOLE_LOG_TEST_MESSAGE');
        expect(cli.stdout).not.toContain('CONSOLE_INFO_TEST_MESSAGE');
        expect(cli.stdout).not.toContain('CONSOLE_DEBUG_TEST_MESSAGE');
        expect(cli.stderr).not.toContain('CONSOLE_WARN_TEST_MESSAGE');
        expect(cli.stderr).not.toContain('CONSOLE_ERROR_TEST_MESSAGE');
        return;
      }

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

      // Verify object arguments use node-style single-line inspection
      expect(cli.stdout).toContain(
        "OBJECT_TEST { key: 'value', nested: { a: 1 } }",
      );

      // Verify array arguments use node-style single-line inspection
      expect(cli.stdout).toContain("ARRAY_TEST [ 1, 2, 3, 'four' ]");

      // Verify errors are forwarded with their stack, like node's util.format
      expect(cli.stdout).toMatch(
        /ERROR_STACK_TEST Error: BOOM_FROM_BROWSER\n\s+at /,
      );

      // Verify log level prefix and test file path are displayed
      expect(cli.stdout).toMatch(/log.*\|.*tests\/console\.test\.ts/);
      expect(cli.stdout).toMatch(/info.*\|.*tests\/console\.test\.ts/);
      expect(cli.stderr).toMatch(/warn.*\|.*tests\/console\.test\.ts/);
      expect(cli.stderr).toMatch(/error.*\|.*tests\/console\.test\.ts/);
      expect(cli.stdout).toMatch(/debug.*\|.*tests\/console\.test\.ts/);
    },
  );

  // `silent: 'passed-only'` buffers logs and replays only the failing tasks'
  // logs through the shared silent-console controller — the same engine the node
  // pool uses. Replayed logs now go through the owning project's `onConsoleLog`
  // filter and honor `disableConsoleIntercept` (previously the browser host
  // flushed straight to reporters, bypassing both — see the drift the isomorphism
  // refactor removes).
  it.for([
    {
      // Default config: failing-task logs replay through reporters, passing-task
      // logs stay buffered (dropped).
      args: ['--silent=passed-only'],
      shouldContain: [
        'BROWSER_FILE_LEVEL_LOG',
        'BROWSER_FAILING_SUITE_LOG',
        'BROWSER_FAILING_CASE_LOG',
        'BROWSER_CONCURRENT_FAILING_CASE_LOG',
      ],
      shouldNotContain: [
        'BROWSER_PASSING_SUITE_LOG',
        'BROWSER_PASSING_CASE_LOG',
      ],
    },
    {
      // `onConsoleLog: () => false` now filters replayed logs too, so nothing
      // reaches the reporters.
      args: [
        '--silent=passed-only',
        '-c',
        'rstest.onConsoleLogFalse.config.mts',
      ],
      shouldContain: [],
      shouldNotContain: [
        'BROWSER_FILE_LEVEL_LOG',
        'BROWSER_FAILING_SUITE_LOG',
        'BROWSER_FAILING_CASE_LOG',
        'BROWSER_PASSING_CASE_LOG',
      ],
    },
    {
      // `disableConsoleIntercept` opts out of host-side console forwarding, so the
      // replay is suppressed host-side (the page console still shows the logs);
      // nothing reaches the CLI, matching plain `--disableConsoleIntercept`.
      args: ['--silent=passed-only', '--disableConsoleIntercept'],
      shouldContain: [],
      shouldNotContain: [
        'BROWSER_FILE_LEVEL_LOG',
        'BROWSER_FAILING_SUITE_LOG',
        'BROWSER_FAILING_CASE_LOG',
        'BROWSER_PASSING_CASE_LOG',
      ],
    },
  ])(
    'should replay failed task logs honoring onConsoleLog/disableConsoleIntercept with args $args',
    async ({ args, shouldContain, shouldNotContain }) => {
      const { cli } = await runBrowserCli('silent', { args });

      await cli.exec;

      for (const message of shouldContain) {
        expect(cli.stdout).toContain(message);
      }
      for (const message of shouldNotContain) {
        expect(cli.stdout).not.toContain(message);
      }
    },
  );
});
