import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

describe('Test timeout', () => {
  it('should throw timeout error when test timeout', async () => {
    const { cli, expectLog, expectStderrLog } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/timeout.test'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await cli.exec;
    expect(cli.exec.process?.exitCode).toBe(1);
    const logs = cli.stdout.split('\n').filter(Boolean);

    expectStderrLog(
      /Error: test timed out in 50ms.*no expect assertions completed/,
    );

    expectStderrLog(/timeout.test.ts:5:5/);

    expectStderrLog(
      /Error: test timed out in 5000ms.*completed 1 expect assertion[^s]/,
    );

    expectStderrLog(/timeout.test.ts:10:5/);

    expectLog(/Tests 2 failed/, logs);
  }, 10000);
});
