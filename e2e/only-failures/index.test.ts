import { rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  beforeEach,
  describe,
  expect,
  it,
  type onTestFinished as OnTestFinished,
} from '@rstest/core';
import { runRstestCli } from '../scripts/';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = join(__dirname, './fixtures');
const cacheDir = join(fixtures, 'node_modules/.cache/.rstest-results');
const extraFile = join(fixtures, 'extra.test.ts');

// With `--pool.maxWorkers 1` files run one at a time; each file logs a unique
// `RUN:<name>` marker, so the set of markers in stdout is exactly the set of
// files that executed.
const ranFiles = (stdout: string): string[] => {
  const files = new Set<string>();
  for (const line of stdout.split('\n')) {
    const match = line.match(/RUN:(first|second|third|extra)/);
    if (match) {
      files.add(match[1]!);
    }
  }
  return [...files].sort();
};

const run = (
  onTestFinished: typeof OnTestFinished,
  env?: Record<string, string>,
  extraArgs: string[] = [],
) =>
  runRstestCli({
    command: 'rstest',
    args: ['run', '--pool.maxWorkers', '1', ...extraArgs],
    onTestFinished,
    options: {
      nodeOptions: {
        cwd: fixtures,
        ...(env ? { env } : {}),
      },
    },
  });

const removeExtra = () => rmSync(extraFile, { force: true });

// Seed the cache with a failed `first` (and passing `second`/`third`).
const recordFirstFailure = async (onTestFinished: typeof OnTestFinished) =>
  (await run(onTestFinished, { FAIL_FIRST: '1' })).expectExecFailed();

describe('--onlyFailures', () => {
  beforeEach(() => {
    rmSync(cacheDir, { recursive: true, force: true });
    removeExtra();
  });

  it('re-runs only the test files that failed on the previous run', async ({
    onTestFinished,
  }) => {
    // Full run with `first` failing → all three files execute and the run fails.
    const full = await run(onTestFinished, { FAIL_FIRST: '1' });
    await full.expectExecFailed();
    expect(ranFiles(full.cli.stdout)).toEqual(['first', 'second', 'third']);

    // `--onlyFailures` re-runs only the failed `first` file (still failing).
    const only = await run(onTestFinished, { FAIL_FIRST: '1' }, [
      '--onlyFailures',
    ]);
    await only.expectExecFailed();
    expect(ranFiles(only.cli.stdout)).toEqual(['first']);
    only.expectLog('onlyFailures: running 1 of 3 test files (2 deselected).');
  }, 90_000);

  it('runs all tests with a notice once the failure is fixed', async ({
    onTestFinished,
  }) => {
    await recordFirstFailure(onTestFinished);

    // `--onlyFailures` re-runs only `first`; without FAIL_FIRST it now passes,
    // clearing its failed state in the cache.
    const fixed = await run(onTestFinished, undefined, ['--onlyFailures']);
    await fixed.expectExecSuccess();
    expect(ranFiles(fixed.cli.stdout)).toEqual(['first']);

    // Nothing failed on the previous run → `--onlyFailures` runs the full suite
    // with a notice (pytest's default, not Jest's "run nothing").
    const clean = await run(onTestFinished, undefined, ['--onlyFailures']);
    await clean.expectExecSuccess();
    clean.expectLog(
      'No failed tests found from the previous run. Running all tests.',
    );
    expect(ranFiles(clean.cli.stdout)).toEqual(['first', 'second', 'third']);
  }, 90_000);

  it('does not select a newly added test file while another file is failing', async ({
    onTestFinished,
  }) => {
    // Full run with `first` failing, recorded in the cache.
    await recordFirstFailure(onTestFinished);

    // Add a brand-new test file AFTER the cache was written, so it has no cache
    // entry (a never-run file).
    writeFileSync(
      extraFile,
      [
        "import { expect, test } from '@rstest/core';",
        '',
        "test('extra', () => {",
        "  console.log('RUN:extra');",
        '  expect(true).toBe(true);',
        '});',
        '',
      ].join('\n'),
    );
    onTestFinished(() => removeExtra());

    // `--onlyFailures` keeps only the failed `first`; the never-run `extra` file
    // is not selected (matches Jest / pytest `--lf`).
    const only = await run(onTestFinished, { FAIL_FIRST: '1' }, [
      '--onlyFailures',
    ]);
    await only.expectExecFailed();
    const ran = ranFiles(only.cli.stdout);
    expect(ran).toContain('first');
    expect(ran).not.toContain('extra');
    expect(ran).toEqual(['first']);
  }, 90_000);

  it('does not narrow an explicit file filter by failure history', async ({
    onTestFinished,
  }) => {
    // Full run: `first` fails, `second`/`third` pass and are cached as passing.
    await recordFirstFailure(onTestFinished);

    // Explicitly scope the run to `first` and `second` while `--onlyFailures` is
    // set. The explicit filter must win: both files run even though `second`
    // passed last time and the failure filter alone would deselect it. This
    // guards the watch `runFailedTests` shortcut, which passes its in-memory
    // failed set as file filters.
    const scoped = await run(onTestFinished, undefined, [
      'first',
      'second',
      '--onlyFailures',
    ]);
    await scoped.expectExecSuccess();
    expect(ranFiles(scoped.cli.stdout)).toEqual(['first', 'second']);
  }, 90_000);
});
