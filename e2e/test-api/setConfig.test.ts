import { describe, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

describe('setConfig & getConfig', () => {
  it('should throw timeout error when test timeout', async () => {
    const { expectExecFailed, expectLog } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/setConfig.test'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await expectExecFailed();
    expectLog(/Error: test timed out in 100ms/);
    expectLog(/Tests 2 failed | 1 passed/);
  });
});
