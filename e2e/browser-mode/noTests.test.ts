import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runBrowserCliWithCwd } from './utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const countMarkers = (output: string, marker: string): number =>
  output.match(new RegExp(marker, 'g'))?.length ?? 0;

describe('browser mode - no tests', () => {
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
});
