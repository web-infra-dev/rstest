import { describe, expect, it } from '@rstest/core';
import { runBrowserCli } from './utils';

describe('browser mode - isolation', () => {
  it('should isolate test files with separate browser contexts', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli('isolation');

    await expectExecSuccess();
    // Both files should pass, meaning they are isolated
    expect(cli.stdout).toMatch(/Test Files.*2.*passed/);
  });
});
