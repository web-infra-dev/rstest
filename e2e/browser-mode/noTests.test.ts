import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { sleep } from '../scripts';
import {
  runBrowserCli,
  runBrowserCliWithCwd,
  runBrowserWatchCli,
} from './utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const countMarkers = (output: string, marker: string): number =>
  output.match(new RegExp(marker, 'g'))?.length ?? 0;

describe('browser mode - no tests', () => {
  it('does not run suite hooks when a test file has no runnable tests', async () => {
    const { cli, expectExecFailed } = await runBrowserCli('empty-suite');

    await expectExecFailed();
    expect(cli.log).toContain('No test found in suite');
    expect(cli.log).not.toContain('EMPTY_SUITE_HOOK_RAN');
  });

  it('does not run empty suite hooks with passWithNoTests', async () => {
    const { cli, expectExecSuccess } = await runBrowserCli('empty-suite', {
      args: ['--passWithNoTests'],
    });

    await expectExecSuccess();
    expect(cli.log).not.toContain('EMPTY_SUITE_HOOK_RAN');
  });

  it('should exit with code 1 by default when no tests found', async () => {
    const { cli, expectExecFailed } = await runBrowserCliWithCwd(
      join(__dirname, 'fixtures', 'no-tests'),
    );

    await expectExecFailed();
    expect(cli.stderr).toContain('No test files found, exiting with code 1.');
  });

  it('should exit with code 0 when passWithNoTests flag is enabled', async () => {
    const { cli, expectExecSuccess } = await runBrowserCliWithCwd(
      join(__dirname, 'fixtures', 'no-tests'),
      { args: ['--passWithNoTests'] },
    );

    await expectExecSuccess();
    expect(cli.stdout).toContain('No test files found, exiting with code 0.');
  });

  // RFC Phase 3 step 2d: a zero-test browser-only non-watch run now routes
  // through core's `finalizeRunCycle` (Appendix A bug 12 fix), so the reporter
  // lifecycle fires, junit/json reporters emit files, and the per-project
  // root/include/exclude detail prints — instead of the old terse early-return.
  it('drives the unified reporter lifecycle when no tests are found', async ({
    onTestFinished,
  }) => {
    const fixtureDir = join(__dirname, 'fixtures', 'no-tests-reporters');
    const jsonPath = join(fixtureDir, '.tmp', 'report.json');
    fs.rmSync(join(fixtureDir, '.tmp'), { recursive: true, force: true });
    onTestFinished(() => {
      fs.rmSync(join(fixtureDir, '.tmp'), { recursive: true, force: true });
    });

    const { cli, expectExecFailed } = await runBrowserCliWithCwd(fixtureDir);
    await expectExecFailed();

    // onTestRunStart / onTestRunEnd each fire exactly once through core.
    expect(countMarkers(cli.stdout, 'PROBE_RUN_START')).toBe(1);
    expect(countMarkers(cli.stdout, 'PROBE_RUN_END')).toBe(1);

    // Per-project root/include/exclude detail prints from `reportNoTestFiles`.
    expect(cli.stderr).toContain('No test files found, exiting with code 1.');
    expect(cli.stdout).toContain('root:');
    expect(cli.stdout).toContain('include:');
    expect(cli.stdout).toContain('exclude:');

    // The json reporter still emits a (zero-test) file instead of nothing.
    const report = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    expect(report.tool).toBe('rstest');
    expect(report.summary.tests).toBe(0);
  });

  // A watch launch with no test files opens no session, so nothing can ever
  // trigger a rerun: core's finalize reports it (once — the host does not print
  // its own copy) and no ready banner is offered, because nothing could answer
  // it. The session process is left for the harness to kill.
  it('reports a watch launch with no test files exactly once', async () => {
    const { cli } = await runBrowserWatchCli('no-tests');

    await cli.waitForStdout('No test files found');
    await sleep(1000);
    expect(countMarkers(cli.log, 'No test files found')).toBe(1);
    expect(cli.log).not.toContain('Waiting for file changes...');
  });
});
