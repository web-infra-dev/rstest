import { describe, expect, it } from '@rstest/core';
import { runBrowserCli, shouldRunHeadedBrowserTests } from './utils';

describe('browser mode - error handling', () => {
  it('should report runtime, assertion, timeout, entry load, expect.element timeout, fixture cleanup, unhandled rejection and hook fixture mismatch errors', async () => {
    const { expectExecFailed, cli } = await runBrowserCli('error', {
      args: [
        'tests/runtimeError.test.ts',
        'tests/assertionError.test.ts',
        'tests/timeoutError.test.ts',
        'tests/loadError.test.ts',
        'tests/elementAssertionTimeout.test.ts',
        'tests/teardownElementAssertionTimeout.test.ts',
        'tests/fixtureCancellationCleanupTimeout.test.ts',
        'tests/useStyleFixtureCleanupTimeout.test.ts',
        'tests/unhandledRejection.test.ts',
        'tests/hookFixtureMismatch.test.ts',
      ],
    });

    // Assert per file before the exit code, so a broken fixture fails the
    // expect that names its behavior.
    await cli.exec;
    await cli.waitForStreamsEnd();
    const output = `${cli.stdout}\n${cli.stderr}`;
    expect(cli.stdout, 'runtime error is reported').toMatch(
      /✗ tests\/runtimeError\.test\.ts \(1\)\n\s+✗ runtime error > should throw runtime error[^\n]*\n\s+Cannot read/,
    );
    expect(cli.stdout, 'assertion error is reported').toMatch(
      /✗ tests\/assertionError\.test\.ts \(1\)\n\s+✗ assertion error > should fail assertion[^\n]*\n\s+expected 1 to be 2/,
    );
    expect(cli.stdout, 'test timeout is reported').toMatch(
      /✗ tests\/timeoutError\.test\.ts \(1\)\n\s+✗ timeout error > should timeout[^\n]*\n\s+test timed out in 100ms/,
    );

    expect(output, 'entry load failure is reported as a failed file').toMatch(
      /✗.*tests\/loadError\.test\.ts \(0\)/,
    );
    expect(output, 'entry load failure message is printed').toContain(
      'BROWSER_ENTRY_LOAD_FAILURE',
    );
    expect(
      output,
      'entry load failure is not escalated to a run-level unhandled error',
    ).not.toContain('Unhandled Error');

    expect(output, 'element assertion file fails').toMatch(
      /✗.*tests\/elementAssertionTimeout\.test\.ts/,
    );
    expect(
      output,
      'default Browser Mode poll timeout is used for expect.element',
    ).toContain(
      `Expect "to.have.text" getByLabel('default-count') with timeout 5000ms`,
    );
    expect(
      output,
      'element mismatch is reported inside the 500ms test deadline',
    ).toContain(`Expect "to.have.text" getByLabel('count', { exact: true })`);
    expect(
      output,
      'element mismatch is reported before the 500ms test timeout',
    ).not.toMatch(/timed out in 500ms/i);

    expect(output, 'teardown element assertion file fails').toMatch(
      /✗.*tests\/teardownElementAssertionTimeout\.test\.ts/,
    );
    expect(output, 'afterEach expect.element mismatch is reported').toContain(
      `Expect "to.have.text" getByLabel('teardown-count')`,
    );
    expect(
      output,
      'afterEach does not inherit the expired body deadline',
    ).not.toContain('afterEach hook timed out in 2000ms');

    expect(output, 'fixture cancellation file fails').toMatch(
      /✗.*tests\/fixtureCancellationCleanupTimeout\.test\.ts/,
    );
    expect(output, 'fixture setup times out at 1000ms').toContain(
      'fixture setup timed out in 1000ms',
    );
    expect(
      output,
      'cancellation cleanup reaches past the element assertion',
    ).toContain('cancellation cleanup reached after element assertion');
    expect(
      output,
      'cancellation cleanup element assertion passes within the fresh deadline',
    ).not.toContain(
      `Expect "to.have.text" getByLabel('cancellation-cleanup-count')`,
    );
    expect(
      output,
      'cancellation cleanup does not hit the fixture cleanup timeout',
    ).not.toContain('fixture cleanup timed out in 1000ms');

    expect(output, 'use-style fixture cleanup file fails').toMatch(
      /✗.*tests\/useStyleFixtureCleanupTimeout\.test\.ts/,
    );
    expect(
      output,
      'use-style fixture cleanup reports the element mismatch',
    ).toContain(`Expect "to.have.text" getByLabel('use-style-cleanup-count')`);
    // The "fixture cleanup timed out in 1000ms" check above also covers the
    // use-style fixture's capped cleanup assertion.

    expect(
      output,
      'escaped unhandled rejection fails its otherwise passing file',
    ).toMatch(/✗.*tests\/unhandledRejection\.test\.ts/);
    expect(output, 'escaped unhandled rejection is reported').toContain(
      'UNHANDLED_BROWSER_REJECTION',
    );

    expect(output, 'hook fixture mismatch file fails').toMatch(
      /✗.*tests\/hookFixtureMismatch\.test\.ts/,
    );
    expect(output, 'missing hook fixture is reported').toContain(
      'Hook has unknown fixture "browserValue"',
    );
    expect(output, 'hook does not run with a missing fixture').not.toContain(
      'browser hook received a missing fixture',
    );

    expect(output, 'every file in the run fails').toContain(
      'Test Files 10 failed',
    );
    await expectExecFailed();
  });

  it('caps explicit expect.element timeouts at the test deadline', async () => {
    const { cli, expectExecFailed } = await runBrowserCli('error', {
      args: [
        'tests/elementAssertionTimeout.test.ts',
        '--testNamePattern',
        'caps explicit element assertion timeout',
      ],
    });

    await expectExecFailed();
    const output = `${cli.stdout}\n${cli.stderr}`;
    const timeout = Number(
      output.match(/Expect "to\.have\.text" \[ with timeout (\d+)ms/)?.[1],
    );
    expect(timeout).toBeGreaterThan(0);
    expect(timeout).toBeLessThan(10_000);
  });

  it('caps explicit zero expect.element timeouts at the test deadline', async () => {
    const { cli, expectExecFailed } = await runBrowserCli('error', {
      args: [
        'tests/elementAssertionTimeout.test.ts',
        '--testNamePattern',
        'caps explicit zero element timeout',
      ],
    });

    await expectExecFailed();
    const output = `${cli.stdout}\n${cli.stderr}`;
    const timeout = Number(
      output.match(/Expect "to\.have\.text" \[ with timeout (\d+)ms/)?.[1],
    );
    expect(timeout).toBeGreaterThan(0);
    expect(timeout).toBeLessThan(10_000);
  });

  it('reports suite hook element mismatches before hook timeouts', async () => {
    const { cli, expectExecFailed } = await runBrowserCli('error', {
      args: [
        'tests/elementAssertionTimeout.test.ts',
        '--testNamePattern',
        'runs suite hooks',
      ],
    });

    await expectExecFailed();
    const output = `${cli.stdout}\n${cli.stderr}`;
    expect(output).toContain('Expect "to.have.text"');
    expect(output).not.toContain('beforeAll hook timed out in 2000ms');
    expect(output).not.toContain('afterAll hook timed out in 2000ms');
    expect(output).not.toContain('fixture setup timed out in 2000ms');
    expect(output).not.toContain('fixture cleanup timed out in 2000ms');
  });

  it('keeps concurrent suite hooks concurrent and their deadlines out of sibling tests', async () => {
    const { cli, expectExecSuccess } = await runBrowserCli('error', {
      args: [
        'tests/concurrentSuiteHooks.test.ts',
        'tests/concurrentElementAssertionContext.test.ts',
      ],
    });

    // Assert per file before the exit code, so a broken fixture fails the
    // expect that names its behavior.
    await cli.exec;
    await cli.waitForStreamsEnd();
    expect(cli.stdout, 'concurrent suite hooks run concurrently').toMatch(
      /✓ tests\/concurrentSuiteHooks\.test\.ts/,
    );
    expect(
      cli.stdout,
      'concurrent suite hook deadline does not leak into sibling element assertion',
    ).toMatch(/✓ tests\/concurrentElementAssertionContext\.test\.ts/);
    await expectExecSuccess();
  });

  it('fails startup when the browser config phase throws', async () => {
    const { cli } = await runBrowserCli('error', {
      args: ['-c', 'rstest.startupError.config.mts'],
    });

    await cli.exec;

    const output = `${cli.stdout}\n${cli.stderr}`;
    expect(cli.exec.exitCode).toBe(1);
    expect(output).toContain('Browser config failed intentionally');
    expect(output).not.toContain('Failed to run Rstest.');
    expect(output).toContain('Unhandled Error');
    expect(output).not.toMatch(/Test Files.*passed/);
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
