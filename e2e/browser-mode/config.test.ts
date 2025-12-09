import { describe, expect, it } from '@rstest/core';
import { runBrowserCli } from './utils';

describe('browser mode - config options', () => {
  it('should work with global config', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli('config');
    await expectExecSuccess();
    expect(cli.stdout).toMatch(/Tests.*passed/);
  });
});
