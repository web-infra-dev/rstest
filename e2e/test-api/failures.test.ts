import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

describe('failing fixtures', () => {
  it('reports error formatting, named fixture, hook fixture mismatch and test options failures', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        'fixtures/namedFixtureCleanupFailure.test.ts',
        'fixtures/error.test.ts',
        'fixtures/errorString.test.ts',
        'fixtures/fullStackFallback.test.ts',
        'fixtures/moduleNotFound.codeFrame.test.ts',
        'fixtures/lessError.test.ts',
        'fixtures/circularReference.test.ts',
        'fixtures/jestError.test.ts',
        'fixtures/hookFixtureMismatch.test.ts',
        'fixtures/fileScopedNamedFixtureCleanupFailure.test.ts',
        'fixtures/fileScopedNamedFixtureCleanupProgress.test.ts',
        'fixtures/fileScopedNamedFixtureSelfDependency.test.ts',
        'fixtures/fileScopedNamedFixtureNested.test.ts',
        'fixtures/namedFixtureInvalidName.test.ts',
        'fixtures/testOptionsRepeatsFail.test.ts',
        'fixtures/testOptionsRepeatsErrorScope.test.ts',
        'fixtures/testOptionsTimeout.test.ts',
        'fixtures/testOptionsThirdArgument.test.js',
        'fixtures/describeOptionsTimeout.test.ts',
      ],
      options: {
        nodeOptions: {
          cwd: dirname(fileURLToPath(import.meta.url)),
        },
      },
    });

    // Assert per file before the exit code, so a broken fixture fails the
    // expect that names its behavior.
    await cli.exec;
    await cli.waitForStreamsEnd();
    const output = `${cli.stdout}\n${cli.stderr}`;

    expect(cli.stderr, 'named fixture cleanup failure is reported').toMatch(
      /FAIL\s+fixtures\/namedFixtureCleanupFailure\.test\.ts > reports named fixture cleanup failures\nError: named fixture cleanup failed/,
    );

    // Error reporting edge cases
    expect(cli.stdout, 'asymmetric matcher failure is reported').toMatch(
      /✗ fixtures\/error\.test\.ts \(1\)\n\s+✗ test asymmetricMatcher error/,
    );
    expect(
      cli.stdout,
      'no unexpected rpc error about result.expected',
    ).not.toContain('Error: Symbol(');
    expect(cli.stderr, 'rejected string is reported as Unknown Error').toMatch(
      /FAIL\s+fixtures\/errorString\.test\.ts > test error string\nUnknown Error: aaaa/,
    );
    expect(
      cli.stderr,
      'fullStack frames shown when filtered stack is empty',
    ).toMatch(
      /FAIL\s+fixtures\/fullStackFallback\.test\.ts > shows first fullStack frame when user stack is empty\nError: fallback stack marker\n\n\s+at fallbackFrame \(node:internal\/rstest_fallback:10:5\)\n\s+at hiddenFrame \(node:internal\/rstest_hidden:20:6\)/,
    );
    expect(cli.stderr, 'no empty-user-stack placeholder').not.toContain(
      'No user error stack found',
    );
    expect(
      cli.stderr,
      'native frames are filtered from fullStack fallback',
    ).not.toContain('nativeFrame');
    expect(cli.stdout, 'runtime module not found error is reported').toMatch(
      /✗ fixtures\/moduleNotFound\.codeFrame\.test\.ts \(1\)\n\s+✗ test expectNotFound error[^\n]*\n\s+Cannot find module 'aaa'/,
    );
    expect(cli.stdout, 'style query build error fails its file').toMatch(
      /✗ fixtures\/lessError\.test\.ts/,
    );
    expect(cli.stderr, 'style query build error shows the Less hint').toMatch(
      /To enable support for Less/,
    );
    expect(
      cli.stderr,
      'build errors are not printed as [object Object]',
    ).not.toContain('[object Object]');
    expect(
      cli.stderr,
      'circular reference in error object is serialized',
    ).toMatch(
      /FAIL\s+fixtures\/circularReference\.test\.ts > should throw AssertionError\nAssertionError: expected .* to deeply equal undefined/,
    );
    expect(cli.stderr, 'jest global shows rstest hint').toMatch(
      /FAIL\s+fixtures\/jestError\.test\.ts > test jest error\nReferenceError: jest is not defined\. Did you mean rstest\?/,
    );

    // Fixture errors
    expect(cli.stderr, 'beforeEach fixture missing from plain test').toMatch(
      /FAIL\s+fixtures\/hookFixtureMismatch\.test\.ts > extended and plain tests > does not provide the hook fixture\nError: Hook has unknown fixture "extendedValue"/,
    );
    expect(
      cli.stderr,
      'afterEach fixture missing from incompatible extended test',
    ).toMatch(
      /FAIL\s+fixtures\/hookFixtureMismatch\.test\.ts > incompatible extended tests > does not provide the first hook fixture\nError: Hook has unknown fixture "firstValue"/,
    );
    expect(
      cli.stderr,
      'beforeEach cleanup fixture missing from plain test',
    ).toMatch(
      /FAIL\s+fixtures\/hookFixtureMismatch\.test\.ts > beforeEach cleanup > does not provide the cleanup fixture\nError: Hook has unknown fixture "cleanupValue"/,
    );
    expect(output, 'hooks never run with a missing fixture').not.toContain(
      'received a missing',
    );
    expect(
      cli.stderr,
      'file-scoped named fixture cleanup failure is reported',
    ).toMatch(
      /FAIL\s+fixtures\/fileScopedNamedFixtureCleanupFailure\.test\.ts\s*\nError: file fixture cleanup failed/,
    );
    expect(cli.stderr, 'pending file fixture setup times out').toMatch(
      /FAIL\s+fixtures\/fileScopedNamedFixtureCleanupProgress\.test\.ts > times out while an unrelated file fixture is pending\nError: fixture setup timed out in 50ms/,
    );
    expect(
      output.indexOf('RSTEST_READY_FILE_FIXTURE_CLEANUP'),
      'ready file fixture is cleaned up',
    ).toBeGreaterThan(-1);
    expect(
      output.indexOf('RSTEST_READY_FILE_FIXTURE_CLEANUP'),
      'ready file fixture cleans up before pending setup settles',
    ).toBeLessThan(output.indexOf('RSTEST_PENDING_FILE_FIXTURE_SETTLED'));
    expect(
      cli.stderr,
      'self-dependent file-scoped fixture is rejected',
    ).toMatch(
      /FAIL\s+fixtures\/fileScopedNamedFixtureSelfDependency\.test\.ts\s*\nError: Circular fixture dependency: value/,
    );
    expect(
      cli.stderr,
      'file-scoped fixture inside a suite is rejected',
    ).toMatch(
      /FAIL\s+fixtures\/fileScopedNamedFixtureNested\.test\.ts\s*\nError: File-scoped fixtures must be defined at the top level of the test file\./,
    );
    expect(cli.stderr, 'invalid named fixture name is rejected').toMatch(
      /FAIL\s+fixtures\/namedFixtureInvalidName\.test\.ts\s*\nError: Invalid named fixture name "base-url"/,
    );

    // Test options
    expect(cli.stdout, 'repeats fail file has a single test').toMatch(
      /✗ fixtures\/testOptionsRepeatsFail\.test\.ts \(1\)/,
    );
    expect(
      cli.stderr,
      'repeats short-circuits on the first failing repeat',
    ).toMatch(
      /FAIL\s+fixtures\/testOptionsRepeatsFail\.test\.ts > fails on the second repeat\nAssertionError: expected 2 to be less than 2/,
    );
    expect(cli.stdout, 'repeat error scope file runs both tests').toMatch(
      /✗ fixtures\/testOptionsRepeatsErrorScope\.test\.ts \(2\)/,
    );
    expect(cli.stderr, 'failing repeat reports its first attempt').toMatch(
      /FAIL\s+fixtures\/testOptionsRepeatsErrorScope\.test\.ts > each repeat reports only its own retry errors\nError: REPEAT_1_ATTEMPT_A/,
    );
    expect(cli.stderr, 'failing repeat reports its second attempt').toMatch(
      /Error: REPEAT_1_ATTEMPT_B/,
    );
    expect(
      cli.stderr,
      'recovered repeat error does not leak into final failure',
    ).not.toContain('REPEAT_0_RECOVERED');
    expect(cli.stderr, 'repeat scheduling sanity test passes').not.toMatch(
      /FAIL\s+fixtures\/testOptionsRepeatsErrorScope\.test\.ts > repeat scheduling sanity/,
    );
    expect(cli.stderr, 'numeric timeout shorthand trips at 50ms').toMatch(
      /FAIL\s+fixtures\/testOptionsTimeout\.test\.ts > timeout shorthand vs options > numeric shorthand still trips on slow body\nError: test timed out in 50ms/,
    );
    expect(cli.stderr, 'options.timeout trips at 50ms').toMatch(
      /FAIL\s+fixtures\/testOptionsTimeout\.test\.ts > timeout shorthand vs options > options\.timeout trips on slow body\nError: test timed out in 50ms/,
    );
    expect(cli.stderr, 'TestOptions in third position is rejected').toMatch(
      /FAIL\s+fixtures\/testOptionsThirdArgument\.test\.js\s*\nError: The third argument must be a number when the second argument is a function\. Use \(name, fn, timeout\) or \(name, options, fn\)\./,
    );
    expect(cli.stdout, 'describe timeout file runs both tests').toMatch(
      /✗ fixtures\/describeOptionsTimeout\.test\.ts \(2\)/,
    );
    expect(cli.stderr, 'describe timeout propagates to inner test').toMatch(
      /FAIL\s+fixtures\/describeOptionsTimeout\.test\.ts > suite timeout propagates > inner test inherits the suite timeout\nError: test timed out in 50ms/,
    );
    expect(
      cli.stderr,
      'per-test timeout overrides describe timeout',
    ).not.toMatch(
      /FAIL\s+fixtures\/describeOptionsTimeout\.test\.ts > suite timeout propagates > per-test timeout overrides the suite timeout/,
    );
    expect(cli.stderr, 'per-test 200ms timeout does not trip').not.toContain(
      'test timed out in 200ms',
    );

    expect(cli.exec.process?.exitCode).toBe(1);
  }, 10000);
});
