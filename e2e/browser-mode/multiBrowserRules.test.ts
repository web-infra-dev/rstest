import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, onTestFinished } from '@rstest/core';
import { runRstestCli } from '../scripts';
import {
  defaultEnvOverrides,
  runBrowserCli,
  shouldRunFirefoxBrowserTests,
} from './utils';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(__dirname, 'fixtures/multi-browser');
const blobDir = join(fixtureDir, '.rstest-reports');

describe('browser mode - multi-browser launch rules', () => {
  it.runIf(shouldRunFirefoxBrowserTests)(
    'runs one file copy per browser with per-entry viewport overrides',
    async () => {
      const { expectExecSuccess, cli } = await runBrowserCli(
        'multi-browser',
        {},
      );
      await expectExecSuccess();
      // One row per (project, browser), each reported as its own
      // `<project> (<browser>)` project, and the per-entry viewport assertion
      // passed inside each real page.
      expect(cli.stdout).toMatch(
        /\[rstest \(chromium\)\].*attribution\.test\.ts/,
      );
      expect(cli.stdout).toMatch(
        /\[rstest \(firefox\)\].*attribution\.test\.ts/,
      );
      expect(cli.stdout).toMatch(/Test Files 2 passed/);
      expect(cli.stdout).toMatch(/Tests 6 passed/);
    },
    60_000,
  );

  it.runIf(shouldRunFirefoxBrowserTests)(
    'filters to one browser like the CLI flag and drops the other copy',
    async () => {
      const { expectExecSuccess, cli } = await runBrowserCli('multi-browser', {
        args: ['--browser.instances=firefox'],
      });

      await expectExecSuccess();
      // One browser row selected → one file result under the plain project
      // name: a project that runs one browser keeps its own name, so neither
      // browser's instance name appears.
      expect(cli.stdout).not.toMatch(/\(chromium\)/);
      expect(cli.stdout).toMatch(/Test Files 1 passed/);
    },
    60_000,
  );

  it('rejects a --browser.instances name that no browser project configures', async () => {
    const { expectExecFailed, cli } = await runBrowserCli('multi-browser', {
      args: ['--browser.instances=webkit'],
    });
    await expectExecFailed();
    expect(`${cli.stdout}\n${cli.stderr}`).toContain(
      'Browser "webkit" from `--browser.instances` is not configured by any selected browser project. Configured browsers per project: "rstest": chromium, firefox.',
    );
  });

  it('rejects a bare browser name in browser.instances and shows the object form', async () => {
    const { expectExecFailed, cli } = await runBrowserCli('multi-browser', {
      args: ['-c', 'rstest.string-instance.config.mts'],
    });
    await expectExecFailed();
    expect(`${cli.stdout}\n${cli.stderr}`).toContain(
      'Use `{ browserName: "chromium" }` instead of "chromium" in `browser.instances`.',
    );
  });

  it.runIf(shouldRunFirefoxBrowserTests)(
    'warns once per run that browser.browser is deprecated',
    async () => {
      const { expectExecSuccess, cli } = await runBrowserCli('multi-browser', {
        args: ['-c', 'rstest.deprecated-browser.config.mts'],
      });
      await expectExecSuccess();
      const output = `${cli.stdout}\n${cli.stderr}`;
      expect(output).toContain('`browser.browser` is deprecated');
      // Warned once per run, not per layer or per file.
      expect(
        output.match(/browser\.browser` is deprecated/g) ?? [],
      ).toHaveLength(1);
    },
    60_000,
  );

  it('rejects v8 coverage when a non-chromium browser stays selected', async () => {
    const { expectExecFailed, cli } = await runBrowserCli('multi-browser', {
      args: ['-c', 'rstest.v8-coverage.config.mts'],
    });
    await expectExecFailed();
    expect(`${cli.stdout}\n${cli.stderr}`).toMatch(
      /Coverage provider 'v8' in browser mode requires Chromium/,
    );
  });

  it('unlocks v8 coverage once --browser.instances selects only chromium', async () => {
    // The v8 guard runs AFTER CLI browser filtering (Vitest #7306): with the
    // filter narrowing the multi-browser project to chromium, the same
    // config runs successfully and collects coverage.
    const { expectExecSuccess, cli } = await runBrowserCli('multi-browser', {
      args: [
        '-c',
        'rstest.v8-coverage.config.mts',
        '--browser.instances=chromium',
      ],
    });
    await expectExecSuccess();
    expect(cli.stdout).toMatch(/Test Files 1 passed/);
    expect(cli.stdout).not.toMatch(/\(firefox\)/);
  }, 60_000);

  it('rejects a second headed browser and names the CLI fix', async () => {
    const { expectExecFailed, cli } = await runBrowserCli('multi-browser', {
      args: ['--browser.headless=false'],
    });
    await expectExecFailed();
    const output = `${cli.stdout}\n${cli.stderr}`;
    expect(output).toMatch(/Only one \(project, browser\) pair can run headed/);
    expect(output).toContain('--browser.instances');
  });

  it('rejects watch with one headed and one headless browser', async () => {
    const result = await runRstestCli({
      command: 'rstest',
      args: ['watch', '-c', 'rstest.mixed-headed.config.mts'],
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

  it.runIf(shouldRunFirefoxBrowserTests)(
    'records one blob per run and merges two browsers back per browser row',
    async () => {
      onTestFinished(() => rmSync(blobDir, { recursive: true, force: true }));
      rmSync(blobDir, { recursive: true, force: true });

      const blobRun = await runBrowserCli('multi-browser', {
        args: ['--reporters=blob'],
      });
      await blobRun.expectExecSuccess();
      expect(existsSync(join(blobDir, 'blob.json'))).toBe(true);

      const merge = await runRstestCli({
        command: 'rstest',
        args: ['merge-reports', '--cleanup'],
        options: { nodeOptions: { cwd: fixtureDir } },
      });
      await merge.expectExecSuccess();
      // Merged output attributes both browser instances again.
      expect(merge.cli.stdout).toMatch(
        /\[rstest \(chromium\)\].*attribution\.test\.ts/,
      );
      expect(merge.cli.stdout).toMatch(
        /\[rstest \(firefox\)\].*attribution\.test\.ts/,
      );
      expect(merge.cli.stdout).toMatch(/Test Files 2 passed/);
    },
    120_000,
  );
});
