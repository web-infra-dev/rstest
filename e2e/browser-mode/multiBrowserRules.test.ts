import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, onTestFinished } from '@rstest/core';
import { runRstestCli } from '../scripts';
import { defaultEnvOverrides, runBrowserCli } from './utils';
import { BROWSER_PORTS } from './fixtures/ports';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(__dirname, 'fixtures/multi-browser');
const blobDir = join(fixtureDir, '.rstest-reports');

// Every browser in this fixture is not one plain chromium entry (firefox is
// present), so each call manages the CI chrome channel inside the config and
// must not inherit an automatic `launch.channel` push. This file must not
// race `multiBrowser.test.ts` for the fixture's own port (configs reached
// from different concurrently-running test files must not share one; the
// loser retries or fails), so every CLI here carries the file-own
// `multi-browser-rules` port.
const rulesPort = `--browser.port=${BROWSER_PORTS['multi-browser-rules']}`;
const rulesCli = (
  args: string[],
  extra?: Omit<
    NonNullable<Parameters<typeof runBrowserCli>[1]>,
    'githubActionsChrome'
  >,
) =>
  runBrowserCli('multi-browser', {
    ...extra,
    githubActionsChrome: false,
    args: [rulesPort, ...args],
  });

describe('browser mode - multi-browser launch rules', () => {
  it('runs one file copy per browser with per-entry viewport overrides', async () => {
    const { expectExecSuccess, cli } = await rulesCli([]);
    await expectExecSuccess();
    // One row per (project, browser), each tagged with its browser, and the
    // per-entry viewport assertion passed inside each real page.
    expect(cli.stdout).toMatch(/\[chromium\].*attribution\.test\.ts/);
    expect(cli.stdout).toMatch(/\[firefox\].*attribution\.test\.ts/);
    expect(cli.stdout).toMatch(/Test Files 2 passed/);
    expect(cli.stdout).toMatch(/Tests 6 passed/);
  }, 60_000);

  it('warns once per run that browser.browser is deprecated', async () => {
    const { expectExecSuccess, cli } = await rulesCli([
      '-c',
      'rstest.deprecated-browser.config.mts',
    ]);
    await expectExecSuccess();
    const output = `${cli.stdout}\n${cli.stderr}`;
    expect(output).toContain('`browser.browser` is deprecated');
    // Warned once per run, not per layer or per file.
    expect(output.match(/browser\.browser` is deprecated/g) ?? []).toHaveLength(
      1,
    );
  }, 60_000);

  it('rejects v8 coverage when a non-chromium browser stays selected', async () => {
    const { expectExecFailed, cli } = await rulesCli([
      '-c',
      'rstest.v8-coverage.config.mts',
    ]);
    await expectExecFailed();
    expect(`${cli.stdout}\n${cli.stderr}`).toMatch(
      /Coverage provider 'v8' in browser mode requires Chromium/,
    );
  });

  it('unlocks v8 coverage once --browser.browsers selects only chromium', async () => {
    // The v8 guard runs AFTER CLI browser filtering (Vitest #7306): with the
    // filter narrowing the multi-browser project to chromium, the same
    // config runs successfully and collects coverage.
    const { expectExecSuccess, cli } = await rulesCli([
      '-c',
      'rstest.v8-coverage.config.mts',
      '--browser.browsers=chromium',
    ]);
    await expectExecSuccess();
    expect(cli.stdout).toMatch(/Test Files 1 passed/);
    expect(cli.stdout).not.toMatch(/\[firefox\]/);
  }, 60_000);

  it('rejects a second headed browser and names the CLI fix', async () => {
    const { expectExecFailed, cli } = await rulesCli([
      '--browser.headless=false',
    ]);
    await expectExecFailed();
    const output = `${cli.stdout}\n${cli.stderr}`;
    expect(output).toMatch(/Only one \(project, browser\) pair can run headed/);
    expect(output).toContain('--browser.browsers');
  });

  it('rejects watch with one headed and one headless browser', async () => {
    const result = await runRstestCli({
      command: 'rstest',
      args: ['watch', '-c', 'rstest.mixed-headed.config.mts', rulesPort],
      options: {
        nodeOptions: {
          cwd: fixtureDir,
          env: { ...defaultEnvOverrides },
        },
      },
    });
    await result.expectExecFailed();
    expect(`${result.cli.stdout}\n${result.cli.stderr}`).toMatch(
      /Watch mode does not support mixing headed/,
    );
  });

  it('records one blob per run and merges two browsers back per browser row', async () => {
    onTestFinished(() => rmSync(blobDir, { recursive: true, force: true }));
    rmSync(blobDir, { recursive: true, force: true });

    const blobRun = await rulesCli(['--reporters=blob']);
    await blobRun.expectExecSuccess();
    expect(existsSync(join(blobDir, 'blob.json'))).toBe(true);

    const merge = await runRstestCli({
      command: 'rstest',
      args: ['merge-reports', '--cleanup'],
      options: { nodeOptions: { cwd: fixtureDir } },
    });
    await merge.expectExecSuccess();
    // Merged output attributes both browser rows again.
    expect(merge.cli.stdout).toMatch(/\[chromium\].*attribution\.test\.ts/);
    expect(merge.cli.stdout).toMatch(/\[firefox\].*attribution\.test\.ts/);
    expect(merge.cli.stdout).toMatch(/Test Files 2 passed/);
  }, 120_000);
});
