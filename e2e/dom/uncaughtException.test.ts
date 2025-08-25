import { describe, expect, it } from '@rstest/core';
import { runCli } from './utils';

const filters = 'test/uncaughtException';

describe('uncaughtException', () => {
  it('should catch & format uncaughtException error correctly', async () => {
    const { cli, expectLog } = await runCli(filters, 'jsdom');

    await cli.exec;

    expect(cli.exec.process?.exitCode).toBe(1);
    expectLog('unhandledRejection: reject error');
  });
});
