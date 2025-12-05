import { describe, it } from '@rstest/core';
import { runCli } from './utils';

const filters = 'test/uncaughtException';

describe('uncaughtException', () => {
  it('should catch & format uncaughtException error correctly', async () => {
    const { expectExecFailed, expectLog } = await runCli(filters, 'jsdom');

    await expectExecFailed();

    expectLog('unhandledRejection: reject error');
  });
});
