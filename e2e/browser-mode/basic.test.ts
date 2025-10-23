import { describe, expect, it } from '@rstest/core';
import { runBrowserCli } from './utils';

describe('browser mode - basic', () => {
  it('should run DOM tests correctly', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli('basic', {
      args: ['tests/dom.test.ts'],
    });

    await expectExecSuccess();
    expect(cli.stdout).toMatch(/Tests.*passed/);
  });

  it('should run event tests correctly', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli('basic', {
      args: ['tests/events.test.ts'],
    });

    await expectExecSuccess();
    expect(cli.stdout).toMatch(/Tests.*passed/);
  });

  it('should run async tests correctly', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli('basic', {
      args: ['tests/async.test.ts'],
    });

    await expectExecSuccess();
    expect(cli.stdout).toMatch(/Tests.*passed/);
  });

  it('should run all basic tests together', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli('basic');

    await expectExecSuccess();
    expect(cli.stdout).toMatch(/Test Files.*passed/);
  });

  it('should exit with code 0 when tests pass', async () => {
    const { cli } = await runBrowserCli('basic', {
      args: ['tests/dom.test.ts'],
    });

    await cli.exec;
    expect(cli.exec.exitCode).toBe(0);
  });
});
