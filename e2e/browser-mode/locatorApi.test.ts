import { describe, expect, it } from '@rstest/core';
import { runBrowserCli } from './utils';

describe('browser mode - locator api', () => {
  it('should run locator API tests correctly', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli('locator-api');

    await expectExecSuccess();
    expect(cli.stdout).toMatch(/Tests.*passed/);
  });
});
