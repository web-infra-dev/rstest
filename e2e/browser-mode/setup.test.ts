import { describe, expect, it } from '@rstest/core';
import { runBrowserCli } from './utils';

describe('browser mode - setup files', () => {
  it('should execute setup files before tests', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli('setup-files');

    await expectExecSuccess();
    expect(cli.stdout).toMatch(/Tests.*passed/);
  });
});
