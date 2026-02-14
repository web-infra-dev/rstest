import { describe, expect, it } from '@rstest/core';
import { runBrowserCli } from './utils';

describe('browser mode - locator api', () => {
  it('should run locator API tests correctly', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli('locator-api');

    await expectExecSuccess();
    expect(cli.stdout).toMatch(/Tests.*passed/);
  });

  it('should run locator API tests in headed mode without scheduler page', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli('locator-api', {
      args: ['--browser.headless', 'false'],
    });

    await expectExecSuccess();
    expect(cli.stdout).toMatch(/Tests.*passed/);
    expect(cli.stdout).not.toContain('/scheduler.html');
  });
});
