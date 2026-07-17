import { describe, expect, it } from '@rstest/core';
import { runCli } from './utils';

it('reports errors canceled after synchronous jsdom dispatch', async () => {
  const { cli, expectStderrLog } = await runCli(
    'test/lateErrorCancellation',
    undefined,
    {
      args: ['--config', 'rstest.lateErrorCancellation.config.mts'],
    },
  );

  await cli.exec;

  expect(cli.exec.process?.exitCode).toBe(1);
  expectStderrLog('late error cancellation');
});

for (const environment of ['jsdom', 'happy-dom'] as const) {
  describe(`${environment} timer errors`, () => {
    it('reports unhandled callback errors', async () => {
      const { expectExecFailed, expectStderrLog } = await runCli(
        'test/timerErrors',
        environment,
      );

      await expectExecFailed();
      expectStderrLog('Timer callback threw undefined');
      expectStderrLog('stopped timer error');
    });
  });
}
