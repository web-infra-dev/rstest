import { describe, expect, it } from '@rstest/core';
import { runBrowserCli } from './utils';

describe('browser mode - config validation warnings', () => {
  it('allows coverage.provider v8 in a Chromium browser-only run', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli('browser-coverage', {
      args: ['-c', 'rstest.v8BrowserOnly.config.mts'],
    });
    await expectExecSuccess();
    expect(`${cli.stdout}\n${cli.stderr}`).toMatch(/Coverage enabled with v8/);
  });

  it('rejects coverage.provider v8 in a non-Chromium browser-only run', async () => {
    const { expectExecFailed, cli } = await runBrowserCli('browser-coverage', {
      args: ['-c', 'rstest.v8Webkit.config.mts'],
    });
    await expectExecFailed();
    expect(`${cli.stdout}\n${cli.stderr}`).toMatch(
      /Coverage provider 'v8' in browser mode requires Chromium/,
    );
  });

  it('lists tests despite coverage.provider v8 in a browser-only project', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli('browser-coverage', {
      command: 'list',
      args: ['-c', 'rstest.v8BrowserOnly.config.mts'],
    });
    await expectExecSuccess();
    expect(cli.stdout).toContain('sum.test.ts');
    // The ignore-warning loop runs on the list path too, and every warned-on
    // option is at its default here (`coverage` is specially handled and never
    // produces an "Ignoring" line) — so this same boot also pins that a default
    // browser config draws no ignore-warnings.
    expect(`${cli.stdout}\n${cli.stderr}`).not.toMatch(
      /Ignoring .* in browser mode/,
    );
  });

  it('collects V8 coverage in a mixed Chromium browser and node run', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli('browser-coverage', {
      args: ['-c', 'rstest.v8Mixed.config.mts'],
    });
    await expectExecSuccess();
    const output = `${cli.stdout}\n${cli.stderr}`;
    expect(output).not.toMatch(/Coverage provider 'v8'/);
    expect(output.replaceAll(' ', '')).toContain('sum.ts|100|100|100|100');
    expect(output.replaceAll(' ', '')).toContain('multiply.ts|100|100|100|100');
  });

  it('warns once on node-only options set for browser projects', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli('browser-coverage', {
      args: ['-c', 'rstest.nodeOnlyFlags.config.mts'],
    });
    await expectExecSuccess();
    const output = `${cli.stdout}\n${cli.stderr}`;
    expect(
      output.match(/Ignoring logHeapUsage in browser mode/g) ?? [],
    ).toHaveLength(1);
    expect(
      output.match(/Ignoring detectAsyncLeaks in browser mode/g) ?? [],
    ).toHaveLength(1);
    expect(
      output.match(/Ignoring pool\.type 'threads' in browser mode/g) ?? [],
    ).toHaveLength(1);
  });

  it('allows Module Federation in browser mode without an ignore warning', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli('basic', {
      args: ['-c', 'rstest.federation.config.mts'],
    });
    await expectExecSuccess();
    expect(`${cli.stdout}\n${cli.stderr}`).not.toMatch(
      /Ignoring federation in browser mode/,
    );
  });
});
