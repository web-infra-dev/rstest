import { describe, expect, it } from '@rstest/core';
import { runBrowserCli } from './utils';

describe('browser mode - config options', () => {
  it('should work with global config', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli('config');
    await expectExecSuccess();
    expect(cli.stdout).toMatch(/Tests.*passed/);
  });

  it('should fail early when browser provider is invalid', async () => {
    const { expectExecFailed, expectStderrLog, cli } =
      await runBrowserCli('invalid-provider');

    await expectExecFailed();
    expectStderrLog(/browser\.provider must be one of: playwright\./);
    expect(cli.stdout).not.toMatch(/Browser mode opened at/);
  });
});
