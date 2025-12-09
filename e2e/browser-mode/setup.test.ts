import { describe, expect, it } from '@rstest/core';
import { runBrowserCli } from './utils';

describe('browser mode - setup files', () => {
  it('should execute setup files before tests', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli('setup-files');

    await expectExecSuccess();
    expect(cli.stdout).toMatch(/Tests.*passed/);
  });

  it('should have globals from setup file available', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli('setup-files');

    await expectExecSuccess();
    // Tests verify that __SETUP_EXECUTED__ and __customHelper__ exist
    expect(cli.stdout).toMatch(/should have setup file executed/);
    expect(cli.stdout).toMatch(/should have custom helper from setup/);
  });
});
