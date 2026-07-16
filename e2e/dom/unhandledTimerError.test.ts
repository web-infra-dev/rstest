import { describe, it } from '@rstest/core';
import { runCli } from './utils';

describe('jsdom timer errors', () => {
  it('fails for observed errors that are not prevented', async () => {
    const { expectExecFailed, expectStderrLog } = await runCli(
      'test/unhandledTimerError',
      'jsdom',
    );

    await expectExecFailed();
    expectStderrLog('Timer callback threw undefined');
  });
});
