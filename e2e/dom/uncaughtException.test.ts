import { describe, it } from '@rstest/core';
import { runCli } from './utils';

const filters = 'test/uncaughtException';

describe('uncaughtException', () => {
  it('should catch & format uncaughtException error correctly', async () => {
    const { expectExecFailed, expectStderrLog } = await runCli(
      filters,
      'jsdom',
    );

    await expectExecFailed();

    expectStderrLog('unhandledRejection: reject error');
  });
});
