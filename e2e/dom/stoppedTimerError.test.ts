import { describe, it } from '@rstest/core';
import { runCli } from './utils';

for (const environment of ['jsdom', 'happy-dom'] as const) {
  describe(`${environment} timer errors`, () => {
    it('fails when error propagation is stopped without prevention', async () => {
      const { expectExecFailed, expectStderrLog } = await runCli(
        'test/stoppedTimerError',
        environment,
      );

      await expectExecFailed();
      expectStderrLog('stopped timer error');
    });
  });
}
