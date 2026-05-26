import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('TestOptions', () => {
  it('per-test retry overrides config.retry', async () => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/testOptionsRetry.test.ts'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });
    await expectExecSuccess();
  });

  it('repeats re-runs a passing test the requested number of times', async () => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/testOptionsRepeatsPass.test.ts'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });
    await expectExecSuccess();
  });

  it('repeats short-circuits on the first failure', async () => {
    const { cli, expectLog } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/testOptionsRepeatsFail.test.ts'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });
    await cli.exec;
    expect(cli.exec.process?.exitCode).toBe(1);
    const logs = cli.stdout.split('\n').filter(Boolean);
    expectLog(/Tests 1 failed/, logs);
  });

  it('retry budget is per-repeat when combined', async () => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/testOptionsRetryRepeats.test.ts'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });
    await expectExecSuccess();
  });

  it('options.retry overrides config.retry both up and down', async () => {
    const { cli, expectLog } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/testOptionsRetryOverride.test.ts', '--retry=5'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });
    await cli.exec;
    // Second case sets retry: 0 and always throws, so the file fails overall.
    expect(cli.exec.process?.exitCode).toBe(1);
    const logs = cli.stdout.split('\n').filter(Boolean);
    // 1 passed (extending retry beyond config), 1 failed (retry: 0 disables).
    expectLog(/Tests 1 failed/, logs);
    expectLog(/1 passed/, logs);
    // The failing case ran exactly once (no retries via config.retry=5).
    expectLog(/attempt 1$/, cli.stderr.split('\n').filter(Boolean));
    expect(cli.stderr).not.toContain('attempt 2');
  });

  it('each repeat reports only its own retry errors', async () => {
    const { cli, expectLog } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/testOptionsRepeatsErrorScope.test.ts'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });
    await cli.exec;
    expect(cli.exec.process?.exitCode).toBe(1);
    const stderrLines = cli.stderr.split('\n').filter(Boolean);
    const stdoutLines = cli.stdout.split('\n').filter(Boolean);
    // Failing repeat's own attempts must be reported.
    expectLog(/REPEAT_1_ATTEMPT_A/, stderrLines);
    expectLog(/REPEAT_1_ATTEMPT_B/, stderrLines);
    // An earlier repeat that recovered must not leak into the final fail.
    expect(cli.stderr).not.toContain('REPEAT_0_RECOVERED');
    // Sanity test must still have observed all 4 executions.
    expectLog(/Tests 1 failed/, stdoutLines);
    expectLog(/1 passed/, stdoutLines);
  });

  it('invalid repeats values do not silently skip', async () => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/testOptionsRepeatsInvalid.test.ts'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });
    await expectExecSuccess();
  });

  it('options.timeout matches numeric shorthand behavior', async () => {
    const { cli, expectStderrLog } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/testOptionsTimeout.test.ts'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });
    await cli.exec;
    expect(cli.exec.process?.exitCode).toBe(1);
    // Both tests (shorthand + options) should report the same 50ms timeout.
    expectStderrLog(/test timed out in 50ms/);
  }, 10000);
});
