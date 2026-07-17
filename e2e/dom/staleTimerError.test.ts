import { describe, it } from '@rstest/core';
import { runCli } from './utils';

const filters = ['test/nonIsolatedTimersA', 'test/nonIsolatedTimersB'];

for (const environment of ['jsdom', 'happy-dom'] as const) {
  describe(`${environment} stale timer errors`, () => {
    it('reports errors from wrappers retained after teardown', async () => {
      const { expectExecFailed, expectStderrLog } = await runCli(
        filters,
        environment,
        {
          args: ['--isolate=false', '--pool.maxWorkers=1'],
          env: { RSTEST_STALE_TIMER_ERROR: '1' },
        },
      );

      await expectExecFailed();
      expectStderrLog('retained stale timer error');
    });
  });
}
