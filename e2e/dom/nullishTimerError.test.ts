import { describe, it } from '@rstest/core';
import { runCli } from './utils';

describe('nullish timer errors', () => {
  it('fails cleanly in jsdom', async () => {
    const { expectExecFailed, expectStderrLog } = await runCli(
      'test/nullishTimerError',
      'jsdom',
    );

    await expectExecFailed();
    expectStderrLog('Timer callback threw undefined');
  });

  it('fails cleanly in happy-dom', async () => {
    const { expectExecFailed, expectStderrLog } = await runCli(
      'test/nullishTimerError',
      'happy-dom',
    );

    await expectExecFailed();
    expectStderrLog('Timer callback threw undefined');
  });
});
