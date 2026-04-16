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
});
