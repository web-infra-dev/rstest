import { describe, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

describe('Test timeout configuration', () => {
  it('should not throw timeout error when update timeout time via testTimeout configuration', async () => {
    const { expectExecFailed, expectLog, expectStderrLog } = await runRstestCli(
      {
        command: 'rstest',
        args: ['run', 'fixtures/timeout.test', '--testTimeout=10000'],
        options: {
          nodeOptions: {
            cwd: __dirname,
          },
        },
      },
    );

    await expectExecFailed();

    // The timeout set by the API is higher than the global configuration item
    expectStderrLog('Error: test timed out in 50ms');
    expectStderrLog('timeout.test.ts:5:5');
    expectLog('Tests 1 failed | 1 passed');
  }, 12000);
});
