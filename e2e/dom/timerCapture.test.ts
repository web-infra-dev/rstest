import { describe, it } from '@rstest/core';
import { runCli } from './utils';

for (const environment of ['jsdom', 'happy-dom'] as const) {
  describe(`${environment} timer capture`, () => {
    it('uses the Node fatal exception path', async () => {
      const { expectExecSuccess } = await runCli(
        'test/timerCapture',
        environment,
      );

      await expectExecSuccess();
    });
  });
}
