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
    expect(cli.stdout).toContain('/scheduler.html');
  });

  it('should run headed mode without scheduler page and exit with code 0', async () => {
    const { cli } = await runBrowserCli('basic', {
      args: ['--browser.headless', 'false', 'tests/dom.test.ts'],
    });

    await cli.exec;
    expect(cli.exec.exitCode).toBe(0);
    expect(cli.stdout).not.toContain('/scheduler.html');
  });
});
