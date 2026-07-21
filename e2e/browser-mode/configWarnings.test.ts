import { describe, expect, it } from '@rstest/core';
import { runBrowserCli } from './utils';

describe('browser mode - config validation warnings', () => {
  it('hard-errors on coverage.provider v8 in a browser-only run', async () => {
    const { expectExecFailed, cli } = await runBrowserCli('browser-coverage', {
      args: ['-c', 'rstest.v8BrowserOnly.config.mts'],
    });
    await expectExecFailed();
    expect(`${cli.stdout}\n${cli.stderr}`).toMatch(
      /Coverage provider 'v8' is not supported in browser mode/,
    );
  });

  it('lists tests despite coverage.provider v8 in a browser-only project', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli('browser-coverage', {
      command: 'list',
      args: ['-c', 'rstest.v8BrowserOnly.config.mts'],
    });
    await expectExecSuccess();
    expect(cli.stdout).toContain('sum.test.ts');
  });

  it('warns (not errors) on coverage.provider v8 in a mixed run, node coverage still runs', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli('browser-coverage', {
      args: ['-c', 'rstest.v8Mixed.config.mts'],
    });
    await expectExecSuccess();
    const output = `${cli.stdout}\n${cli.stderr}`;
    expect(output).toMatch(
      /Coverage provider 'v8' produces no coverage for browser project/,
    );
    // The node project still executes.
    expect(output).toMatch(/multiply/);
  });

  it('warns once on node-only options set for browser projects', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli('browser-coverage', {
      args: ['-c', 'rstest.nodeOnlyFlags.config.mts'],
    });
    await expectExecSuccess();
    const output = `${cli.stdout}\n${cli.stderr}`;
    expect(output).toMatch(/Ignoring logHeapUsage in browser mode/);
    expect(output).toMatch(/Ignoring detectAsyncLeaks in browser mode/);
    expect(output).toMatch(/Ignoring pool\.type 'threads' in browser mode/);
  });

  it('emits no ignore-warnings for a default browser config', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli('browser-coverage');
    await expectExecSuccess();
    expect(`${cli.stdout}\n${cli.stderr}`).not.toMatch(
      /Ignoring .* in browser mode/,
    );
  });
});
