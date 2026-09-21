import { describe, expect, it } from '@rstest/core';
import { runBrowserCli } from './utils';

describe('browser mode - federation globalSetup', () => {
  it('uses the inferred Node federation preset for globalSetup', async () => {
    const { cli, expectExecSuccess } = await runBrowserCli(
      'browser-federation-global-setup',
    );

    await expectExecSuccess();

    expect(cli.stdout).toContain('[federation-remote] requested');
    expect(cli.stdout).toContain('[federation-global-teardown] executed');
    expect(cli.stdout).toMatch(/Test Files.*1 passed/);
    expect(cli.stdout).toMatch(/Tests.*2 passed/);
  });
});
