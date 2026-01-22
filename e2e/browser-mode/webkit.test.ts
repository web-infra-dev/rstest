import { describe, expect, it } from '@rstest/core';
import { runBrowserCli } from './utils';

describe('browser mode - webkit browser', () => {
  it('should run tests with webkit browser', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli('webkit');

    await expectExecSuccess();
    expect(cli.stdout).toMatch(/Tests.*passed/);
    // Verify webkit test file was run
    expect(cli.stdout).toMatch(/webkit\.test\.ts/);
  });
});
