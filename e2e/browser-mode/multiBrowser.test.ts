import { describe, expect, it } from '@rstest/core';
import { runBrowserCli } from './utils';

// Chromium and Firefox run the SAME file with ONE build; every reporter row
// must say which browser produced each of the two distinct results.
describe('browser mode - multi-browser attribution', () => {
  it('runs one file copy per browser with per-browser reporter rows', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli('multi-browser', {});

    await expectExecSuccess();
    // One row per (project, browser): the file title carries the browser tag
    // on both copies, so the run shows two distinct file results.
    expect(cli.stdout).toMatch(/\[chromium\].*attribution\.test\.ts/);
    expect(cli.stdout).toMatch(/\[firefox\].*attribution\.test\.ts/);
    expect(cli.stdout).toMatch(/Test Files 2 passed/);
  }, 60_000);

  it('filters to one browser like the CLI flag and drops the other copy', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli('multi-browser', {
      args: ['--browser.browsers=firefox'],
    });

    await expectExecSuccess();
    // One browser row selected → one file result, and the dropped copy's
    // tag must not leak anywhere. (The reporter tags rows only when the
    // selected project still records more than one browser, so the
    // narrowed run here prints an untagged single row.)
    expect(cli.stdout).not.toMatch(/\[chromium\]/);
    expect(cli.stdout).toMatch(/Test Files 1 passed/);
  }, 60_000);
});
