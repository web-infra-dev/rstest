import { describe, expect, it } from '@rstest/core';
import { runBrowserCli } from './utils';

describe('browser mode - viewport', () => {
  it('should apply viewport config to runner iframe', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli('viewport');
    await expectExecSuccess();
    expect(cli.stdout).toMatch(/Tests.*passed/);
  });

  it('should apply preset viewport config to runner iframe', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli('viewport-preset');
    await expectExecSuccess();
    expect(cli.stdout).toMatch(/Tests.*passed/);
  });
});
