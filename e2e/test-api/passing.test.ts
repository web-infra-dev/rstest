import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

describe('passing fixtures', () => {
  it('shares file-scoped named fixtures until afterAll, cleans worker fixtures, and passes module-not-found, only-in-skip, test options and context signal fixtures', async () => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        'fixtures/fileScopedNamedFixture.test.ts',
        'fixtures/moduleNotFound.test.ts',
        'fixtures/onlyInSkip.test.ts',
        'fixtures/workerScopedNamedFixture.test.ts',
        'fixtures/testOptionsRetry.test.ts',
        'fixtures/testOptionsRepeatsPass.test.ts',
        'fixtures/testOptionsRetryRepeats.test.ts',
        'fixtures/testOptionsRepeatsInvalid.test.ts',
        'fixtures/testOptionsOnFinishedScope.test.ts',
        'fixtures/testContextSignal.test.ts',
        'fixtures/describeOptionsRetry.test.ts',
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

    expect(cli.stdout, 'file-scoped named fixture file passes').toMatch(
      /✓ fixtures\/fileScopedNamedFixture\.test\.ts \(4\)/,
    );
    const lifecycle = [
      'RSTEST_FILE_FIXTURE_BASE_SETUP',
      'RSTEST_FILE_FIXTURE_DERIVED_SETUP',
      'RSTEST_FILE_FIXTURE_AFTER_ALL',
      'RSTEST_FILE_FIXTURE_DERIVED_CLEANUP',
      'RSTEST_FILE_FIXTURE_BASE_CLEANUP',
    ];
    for (const event of lifecycle) {
      expect(output).toContain(event);
    }
    for (let index = 1; index < lifecycle.length; index++) {
      expect(output.indexOf(lifecycle[index]!)).toBeGreaterThan(
        output.indexOf(lifecycle[index - 1]!),
      );
    }

    expect(
      cli.stdout,
      'missing dynamic import resolves at runtime and both cases pass',
    ).toMatch(/✓ fixtures\/moduleNotFound\.test\.ts \(2\)/);
    expect(
      cli.stdout,
      'missing module is not reported as a build error',
    ).not.toContain('Build error');
    expect(cli.stdout, 'missing module is silent at build time').not.toContain(
      'Module not found',
    );
    expect(
      cli.stdout,
      'it.only inside describe.skip skips every test in the file',
    ).toMatch(/- fixtures\/onlyInSkip\.test\.ts \(3\)/);
    expect(cli.stdout, 'worker-scoped fixture file passes').toMatch(
      /✓ fixtures\/workerScopedNamedFixture\.test\.ts \(2\)/,
    );
    expect(
      output,
      'worker fixture cleanup runs before the isolated worker exits',
    ).toContain('scope:worker:cleanup');
    expect(cli.stdout, 'per-test retry overrides config.retry').toMatch(
      /✓ fixtures\/testOptionsRetry\.test\.ts \(1\)/,
    );
    expect(
      cli.stdout,
      'repeats re-runs a passing test and its hooks each time',
    ).toMatch(/✓ fixtures\/testOptionsRepeatsPass\.test\.ts \(1\)/);
    expect(cli.stdout, 'retry budget is per-repeat when combined').toMatch(
      /✓ fixtures\/testOptionsRetryRepeats\.test\.ts \(1\)/,
    );
    expect(
      cli.stdout,
      'invalid repeats values clamp instead of skipping',
    ).toMatch(/✓ fixtures\/testOptionsRepeatsInvalid\.test\.ts \(3\)/);
    expect(
      cli.stdout,
      'onTestFinished does not leak across retries or repeats',
    ).toMatch(/✓ fixtures\/testOptionsOnFinishedScope\.test\.ts \(3\)/);
    expect(cli.stdout, 'context signal tests pass').toMatch(
      /✓ fixtures\/testContextSignal\.test\.ts \(6\)/,
    );
    expect(cli.stdout, 'timed-out attempt aborts its context signal').toContain(
      'RSTEST_TEST_CONTEXT_SIGNAL_ABORTED',
    );
    expect(
      cli.stdout,
      'describe retry propagates and per-test retry wins',
    ).toMatch(/✓ fixtures\/describeOptionsRetry\.test\.ts \(2\)/);
    await expectExecSuccess();
  });
});
