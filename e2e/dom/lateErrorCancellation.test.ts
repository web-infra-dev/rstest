import { expect, it } from '@rstest/core';
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
