import { describe, expect, it } from '@rstest/core';
import { runBrowserCli, shouldRunHeadedBrowserTests } from './utils';

describe('browser mode - error handling', () => {
  it('should handle runtime, assertion, and timeout errors', async () => {
    const { expectExecFailed, cli } = await runBrowserCli('error', {
      args: [
        'tests/runtimeError.test.ts',
        'tests/assertionError.test.ts',
        'tests/timeoutError.test.ts',
      ],
    });

    await expectExecFailed();
    expect(cli.stdout).toMatch(/fail|timeout/i);
    expect(cli.stdout).toMatch(/nonExistent|Cannot read/);
    expect(cli.stdout).toMatch(/expected.*to.*be/i);
  });

  it('should exit with non-zero code when tests fail', async () => {
    const { cli } = await runBrowserCli('error', {
      args: ['tests/assertionError.test.ts'],
    });

    await cli.exec;
    expect(cli.exec.exitCode).not.toBe(0);
  });

  it('reports an expect.element mismatch before the test timeout', async () => {
    const { cli, expectExecFailed } = await runBrowserCli('error', {
      args: ['tests/elementAssertionTimeout.test.ts'],
    });

    await expectExecFailed();
    const output = `${cli.stdout}\n${cli.stderr}`;
    expect(output).toContain('Expect "to.have.text"');
    expect(output).toContain('with timeout 5000ms');
    expect(output).not.toMatch(/timed out in 500ms/i);
  });

  it('resets the element timeout before teardown hooks', async () => {
    const { cli, expectExecFailed } = await runBrowserCli('error', {
      args: ['tests/teardownElementAssertionTimeout.test.ts'],
    });

    await expectExecFailed();
    expect(`${cli.stdout}\n${cli.stderr}`).toContain('with timeout 5000ms');
  });

  it('should exit non-zero via core when the browser fails to launch', async () => {
    // A bad executablePath makes the provider launch throw. The host returns a
    // fatal outcome (`results: []`, `errors: [launchError]`) that core's
    // finalizeRunCycle reports and turns into a non-zero exit — no test runs.
    // Passing the option as a `--browser.providerOptions.launch.*` arg also
    // suppresses the CI chrome-channel injection in `applyGithubActionsChrome`.
    const { cli } = await runBrowserCli('error', {
      args: [
        'tests/assertionError.test.ts',
        '--browser.providerOptions.launch.executablePath=/rstest/nonexistent-browser-binary',
      ],
    });

    await cli.exec;

    const output = `${cli.stdout}\n${cli.stderr}`;
    expect(cli.exec.exitCode).not.toBe(0);
    expect(output).toMatch(/Failed to launch/i);
    // No test result is produced on a launch failure (`results: []`); the
    // assertion fixture's own failure message must not appear.
    expect(output).not.toMatch(/expected.*to.*be/i);
  });

  it('should fail the file when an unhandled rejection escapes a test', async () => {
    const { cli } = await runBrowserCli('error', {
      args: ['tests/unhandledRejection.test.ts'],
    });

    await cli.exec;

    // The single test passes, but the escaped rejection must fail the file
    // (parity with node's uncaughtException/unhandledRejection capture).
    expect(cli.exec.exitCode).not.toBe(0);
    expect(`${cli.stdout}\n${cli.stderr}`).toContain(
      'UNHANDLED_BROWSER_REJECTION',
    );
  });

  it('keeps a zero poll timeout finite in Browser Mode', async () => {
    const { cli, expectExecFailed } = await runBrowserCli('error', {
      args: [
        '-c',
        'rstest.zeroPoll.config.mts',
        'tests/elementAssertionTimeout.test.ts',
      ],
    });

    await expectExecFailed();
    expect(`${cli.stdout}\n${cli.stderr}`).toContain('with timeout 1ms');
  });

  it('reports hook fixtures missing from browser tests', async () => {
    const { cli, expectExecFailed } = await runBrowserCli('error', {
      args: ['tests/hookFixtureMismatch.test.ts'],
    });

    await expectExecFailed();
    const output = `${cli.stdout}\n${cli.stderr}`;
    expect(output).toContain('Hook has unknown fixture "browserValue"');
    expect(output).not.toContain('browser hook received a missing fixture');
  });

  it('continues after one file fixture cleanup times out', async () => {
    const { cli, expectExecFailed } = await runBrowserCli('error', {
      args: [
        'tests/aFileFixtureCleanupTimeout.test.ts',
        'tests/bAfterFileFixtureCleanupTimeout.test.ts',
        '--pool.maxWorkers=1',
      ],
    });

    await expectExecFailed();
    const output = `${cli.stdout}\n${cli.stderr}`;
    expect(output).toContain(
      'File fixture cleanup did not finish within 10000ms',
    );
    expect(output).toContain(
      'RSTEST_BROWSER_CONTINUED_AFTER_FILE_CLEANUP_TIMEOUT',
    );
    expect(output).toMatch(/Test Files.*1 failed.*1 passed/);
  });

  it.runIf(shouldRunHeadedBrowserTests)(
    'continues headed execution after one file fixture cleanup times out',
    async () => {
      const { cli, expectExecFailed } = await runBrowserCli('error', {
        args: [
          '--browser.headless',
          'false',
          'tests/aFileFixtureCleanupTimeout.test.ts',
          'tests/bAfterFileFixtureCleanupTimeout.test.ts',
        ],
      });

      await expectExecFailed();
      const output = `${cli.stdout}\n${cli.stderr}`;
      expect(output).toContain(
        'File fixture cleanup did not finish within 10000ms',
      );
      expect(output).toContain(
        'RSTEST_BROWSER_CONTINUED_AFTER_FILE_CLEANUP_TIMEOUT',
      );
      expect(output).toMatch(/Test Files.*1 failed.*1 passed/);
    },
  );
});
