import { describe, expect, it } from '@rstest/core';
import { runBrowserCli } from './utils';

describe('browser mode - react', () => {
  it('should run React JSX rendering tests correctly', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli('react');

    await expectExecSuccess();
    expect(cli.stdout).toMatch(/Tests.*passed/);
  });

  it('should pass all React component tests', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli('react');

    await expectExecSuccess();
    expect(cli.stdout).toMatch(/Test Files.*passed/);
  });

  it('should exit with code 0 when React tests pass', async () => {
    const { cli } = await runBrowserCli('react');

    await cli.exec;
    expect(cli.exec.exitCode).toBe(0);
  });
});
