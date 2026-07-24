import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesDir = join(__dirname, 'fixtures');

const PAYLOAD_RE = /__RSTEST_API_RESULT__(.*?)__END__/;

const parsePayload = (stdout: string) => {
  const match = stdout.match(PAYLOAD_RE);
  const payload = match?.[1];
  if (!payload) {
    throw new Error(
      `createRstest payload not found in stdout. Got:\n${stdout.slice(0, 4000)}`,
    );
  }
  return JSON.parse(payload) as Record<string, any>;
};

describe('programmatic createRstest', () => {
  it('runs disk tests via inline config object + returns nested stats', async ({
    onTestFinished,
  }) => {
    const { cli } = await runRstestCli({
      command: 'node',
      args: ['run-inline.mjs'],
      onTestFinished,
      options: { nodeOptions: { cwd: fixturesDir } },
    });

    await cli.exec;
    const result = parsePayload(cli.stdout);

    expect(result.ok).toBe(true);
    expect(result.stats).toEqual({
      tests: { total: 2, passed: 2, failed: 0, skipped: 0, todo: 0 },
      files: { total: 1, failed: 0 },
    });
    expect(result.files).toEqual([{ status: 'pass', testPath: 'sum.test.ts' }]);
    expect(result.unhandledErrors).toEqual([]);
    expect(result.duration.hasTotal).toBe(true);
    expect(result.snapshotPresent).toBe(true);
  });

  it('eager context build preserves the resolved reporter config', async ({
    onTestFinished,
  }) => {
    const { cli } = await runRstestCli({
      command: 'node',
      args: ['create-context-reporters.mjs'],
      onTestFinished,
      options: { nodeOptions: { cwd: fixturesDir } },
    });

    await cli.exec;
    const result = parsePayload(cli.stdout);

    // The eager build resolves config for inspection without running or
    // constructing reporters — so the configured reporters survive on the
    // resolved normalized config.
    expect(result.rootReporters).toEqual(['dot']);
    // `context` is a plain projection: it exposes the resolved projects and is
    // structured-clonable (the raw engine object would throw on its reporters).
    expect(result.projectNames.length).toBeGreaterThan(0);
    expect(result.cloneOk).toBe(true);
    expect(result.hostExitCode).toBe(0);
  });

  it('reports failures via ok=false without poisoning host process.exitCode', async ({
    onTestFinished,
  }) => {
    const { cli } = await runRstestCli({
      command: 'node',
      args: ['run-failing.mjs'],
      onTestFinished,
      options: { nodeOptions: { cwd: fixturesDir } },
    });

    const exec = await cli.exec;
    const result = parsePayload(cli.stdout);

    expect(result.ok).toBe(false);
    expect(result.stats.tests.failed).toBe(1);
    expect(result.stats.files.failed).toBe(1);
    // Host script exited 0 — the API didn't set process.exitCode.
    expect(result.hostExitCode).toBe(0);
    expect(exec.exitCode).toBe(0);
  });

  it('config factory loads the disk config itself and transforms it', async ({
    onTestFinished,
  }) => {
    const { cli } = await runRstestCli({
      command: 'node',
      args: ['run-config-fn.mjs'],
      onTestFinished,
      options: { nodeOptions: { cwd: fixturesDir } },
    });

    await cli.exec;
    const result = parsePayload(cli.stdout);

    // The zero-arg factory loaded the disk config (a.test.ts + b.test.ts) via
    // `loadConfig`, then narrowed `include` to a.test.ts, so only it runs.
    expect(result.ok).toBe(true);
    expect(result.files).toEqual([{ status: 'pass', testPath: 'a.test.ts' }]);
    expect(result.stats.files.total).toBe(1);
  });

  it('resolves a disk config idempotently: extends preset is applied once, not twice', async ({
    onTestFinished,
  }) => {
    const { cli } = await runRstestCli({
      command: 'node',
      args: ['run-extends-once.mjs'],
      onTestFinished,
      options: { nodeOptions: { cwd: fixturesDir } },
    });

    await cli.exec;
    const result = parsePayload(cli.stdout);

    // `loadConfig` already resolved `extends`; resolving again in the API must
    // not duplicate the preset's setupFiles entry, so the setup file runs once.
    expect(result.setupFiles).toEqual(['setup.ts']);
    expect(result.ok).toBe(true);
    expect(result.testsPassed).toBe(1);
    expect(result.testsFailed).toBe(0);
    expect(result.hostExitCode).toBe(0);
  });

  it('never leaves host process.env mutated (construction or run)', async ({
    onTestFinished,
  }) => {
    const { cli } = await runRstestCli({
      command: 'node',
      args: ['run-env-restore.mjs'],
      onTestFinished,
      options: { nodeOptions: { cwd: fixturesDir } },
    });

    await cli.exec;
    const result = parsePayload(cli.stdout);

    expect(result.ok).toBe(true);
    // Host started without NODE_ENV / RSTEST.
    expect(result.before).toEqual({ NODE_ENV: null, RSTEST: null });
    // Creating the instance is host-safe — it doesn't leave the host in test mode.
    expect(result.afterCreate).toEqual(result.before);
    // run() restores the host environment the way it found it.
    expect(result.afterRun).toEqual(result.before);
    expect(result.hostExitCode).toBe(0);
  });

  it('restores host process.env when creation fails', async ({
    onTestFinished,
  }) => {
    const { cli } = await runRstestCli({
      command: 'node',
      args: ['run-create-failure.mjs'],
      onTestFinished,
      options: { nodeOptions: { cwd: fixturesDir } },
    });

    await cli.exec;
    const result = parsePayload(cli.stdout);

    expect(result.threw).toBe(true);
    expect(result.before).toEqual({ NODE_ENV: null, RSTEST: null });
    // A creation failure must not leave the host permanently in test mode.
    expect(result.after).toEqual(result.before);
  });

  it('collects task locations when listTests({ printLocation: true })', async ({
    onTestFinished,
  }) => {
    const { cli } = await runRstestCli({
      command: 'node',
      args: ['run-list-location.mjs'],
      onTestFinished,
      options: { nodeOptions: { cwd: fixturesDir } },
    });

    await cli.exec;
    const result = parsePayload(cli.stdout);

    // printLocation drives includeTaskLocation, so locations are collected.
    expect(result.withLocation).toEqual({ line: true });
    // Without it, the runtime skips location collection.
    expect(result.withoutLocation).toBe(null);
    expect(result.hostExitCode).toBe(0);
  });

  it('listTests ignores execution-only shard and returns the full set', async ({
    onTestFinished,
  }) => {
    const { cli } = await runRstestCli({
      command: 'node',
      args: ['run-list-shard.mjs'],
      onTestFinished,
      options: { nodeOptions: { cwd: fixturesDir } },
    });

    await cli.exec;
    const result = parsePayload(cli.stdout);

    // Listing never executes, so `shard` must not slice the collected files:
    // both calls see every file.
    expect(result.fullFiles).toBeGreaterThan(1);
    expect(result.shardedFiles).toBe(result.fullFiles);
    expect(result.hostExitCode).toBe(0);
  });

  it('tracks the loaded config file for buildCache dependency resolution', async ({
    onTestFinished,
  }) => {
    const { cli } = await runRstestCli({
      command: 'node',
      args: ['run-config-file-buildcache.mjs'],
      onTestFinished,
      options: { nodeOptions: { cwd: fixturesDir } },
    });

    await cli.exec;
    const result = parsePayload(cli.stdout);

    // The config-relative buildDependency resolved against the config file's
    // directory, so the config file path threaded through from `loadConfig`.
    expect(result.resolvedDep).toBe(result.expected);
    expect(result.hostExitCode).toBe(0);
  });

  it('watch() runs, exposes a closeable watcher, and tears down cleanly', async ({
    onTestFinished,
  }) => {
    const { cli } = await runRstestCli({
      command: 'node',
      args: ['run-watch.mjs'],
      onTestFinished,
      options: { nodeOptions: { cwd: fixturesDir } },
    });

    // If close() leaked the dev server / worker pool, the host would hang and
    // this exec would never resolve.
    const exec = await cli.exec;
    const result = parsePayload(cli.stdout);

    expect(result.ranAtLeastOnce).toBe(true);
    expect(result.hasClose).toBe(true);
    expect(result.hostExitCode).toBe(0);
    expect(exec.exitCode).toBe(0);
  });

  it('watch() rejects for browser-mode config instead of leaking a dead handle', async ({
    onTestFinished,
  }) => {
    const { cli } = await runRstestCli({
      command: 'node',
      args: ['run-watch-browser.mjs'],
      onTestFinished,
      options: { nodeOptions: { cwd: fixturesDir } },
    });

    await cli.exec;
    const result = parsePayload(cli.stdout);

    // The guard fires pre-run, so no watcher is ever returned...
    expect(result.hadWatcher).toBe(false);
    expect(result.message).toContain('does not support browser mode yet');
    // ...and the rejected watch leaves the host exit code clean.
    expect(result.hostExitCode).toBe(0);
  });

  it('watch() onResult delivers each run as a run()-parity TestRunResult, surfacing failures', async ({
    onTestFinished,
  }) => {
    const { cli } = await runRstestCli({
      command: 'node',
      args: ['run-watch-onresult.mjs'],
      onTestFinished,
      options: { nodeOptions: { cwd: fixturesDir } },
    });

    const exec = await cli.exec;
    const result = parsePayload(cli.stdout);

    // The failing file's failure reaches the caller through `onResult` rather
    // than being silently swallowed — with no custom reporter registered.
    expect(result.ok).toBe(false);
    expect(result.stats.tests.passed).toBe(2);
    expect(result.stats.tests.failed).toBe(1);
    expect(result.stats.files.failed).toBe(1);
    expect(result.hasFiles).toBe(true);
    expect(result.unhandledErrorsCount).toBe(0);
    // A failing watch run must not leak a non-zero exit code onto the host.
    expect(result.hostExitCode).toBe(0);
    expect(exec.exitCode).toBe(0);
  });

  it('fails the run (ok=false) when a coverage threshold is not met, even though every test passes', async ({
    onTestFinished,
  }) => {
    const { cli } = await runRstestCli({
      command: 'node',
      args: ['run-coverage-threshold.mjs'],
      onTestFinished,
      options: { nodeOptions: { cwd: fixturesDir } },
    });

    await cli.exec;
    const result = parsePayload(cli.stdout);

    // The test itself passes...
    expect(result.stats.tests.failed).toBe(0);
    expect(result.stats.files.failed).toBe(0);
    // ...but the unmet coverage threshold (an exit-code-only failure) must
    // still surface as ok=false, mirroring the CLI.
    expect(result.ok).toBe(false);
    // run() restored the host exit code, so the embedder isn't poisoned.
    expect(result.hostExitCode).toBe(0);
  });

  it('ignores a pre-existing host exitCode when computing ok', async ({
    onTestFinished,
  }) => {
    const { cli } = await runRstestCli({
      command: 'node',
      args: ['run-preexisting-exitcode.mjs'],
      onTestFinished,
      options: { nodeOptions: { cwd: fixturesDir } },
    });

    await cli.exec;
    const result = parsePayload(cli.stdout);

    // The run passes, so ok stays true even though the host had marked itself
    // failed (exitCode=1) before calling run().
    expect(result.stats.tests.failed).toBe(0);
    expect(result.ok).toBe(true);
    // The host's own pre-existing exit code is restored, not clobbered.
    expect(result.hostExitCode).toBe(1);
  });

  it('accepts inline config + virtual modules plugin (Midscene shape)', async ({
    onTestFinished,
  }) => {
    const { cli } = await runRstestCli({
      command: 'node',
      args: ['run-virtual.mjs'],
      onTestFinished,
      options: { nodeOptions: { cwd: fixturesDir } },
    });

    await cli.exec;
    const result = parsePayload(cli.stdout);

    expect(result.ok).toBe(true);
    expect(result.stats.tests.passed).toBe(1);
    expect(result.files).toEqual([
      { status: 'pass', testName: 'virtual/programmatic.test.ts' },
    ]);
  });

  it('returns metadata from test context and suite hooks', async ({
    onTestFinished,
  }) => {
    const { cli } = await runRstestCli({
      command: 'node',
      args: ['run-metadata.mjs'],
      onTestFinished,
      options: { nodeOptions: { cwd: fixturesDir } },
    });

    await cli.exec;
    const result = parsePayload(cli.stdout);

    expect(result.ok).toBe(true);
    expect(result.fileMeta).toEqual({ fileHook: 'afterAll' });
    expect(result.caseMeta).toEqual([
      { fromSuite: true, shared: 'suite' },
      {
        fromSuite: true,
        shared: 'case',
        caseOnly: true,
        caseValue: 'second',
        replaced: true,
      },
    ]);
    expect(result.reporterFileMeta).toEqual({ fileHook: 'afterAll' });
    expect(result.reporterCaseMeta).toEqual([
      { fromSuite: true, shared: 'suite' },
      {
        fromSuite: true,
        shared: 'case',
        caseOnly: true,
        caseValue: 'second',
        replaced: true,
      },
    ]);
    expect(result.suiteMeta).toEqual([
      { fromSuite: true, shared: 'suite', suiteHook: 'afterAll' },
    ]);
  });

  it('mergeReports resolves the merged TestRunResult and rejects only on operational failure', async ({
    onTestFinished,
  }) => {
    const { cli } = await runRstestCli({
      command: 'node',
      args: ['run-merge-reports.mjs'],
      onTestFinished,
      options: { nodeOptions: { cwd: fixturesDir } },
    });

    await cli.exec;
    const result = parsePayload(cli.stdout);

    // Failing merged blobs surface as data (ok=false + per-file detail), not a
    // rejection — mirroring the CLI's exit 1.
    expect(result.fail.ok).toBe(false);
    expect(result.fail.failedTests).toBeGreaterThan(0);
    expect(result.fail.failedFiles).toBeGreaterThan(0);
    expect(result.fail.hasFileDetail).toBe(true);
    // All-passing blobs merge to ok=true.
    expect(result.pass.ok).toBe(true);
    expect(result.pass.passedTests).toBeGreaterThan(0);
    // A merge that can't be performed rejects with the original core error.
    expect(result.missingRejected).toBe(true);
    expect(result.missingError).toMatch(
      /No blob report files found|directory not found/,
    );
    // The host's exit code is left untouched by any of the merges.
    expect(result.hostExitCode).toBe(0);
  });

  it('run({ related }) runs only related test files for a source file (jest findRelatedTests parity)', async ({
    onTestFinished,
  }) => {
    const { cli } = await runRstestCli({
      command: 'node',
      args: ['run-related.mjs'],
      onTestFinished,
      options: { nodeOptions: { cwd: fixturesDir } },
    });

    await cli.exec;
    const result = parsePayload(cli.stdout);

    // Only `math.test.ts` depends on `src/math.ts`; `unrelated.test.ts` is dropped.
    expect(result.ok).toBe(true);
    expect(result.files).toEqual([
      { status: 'pass', testPath: 'math.test.ts' },
    ]);
    expect(result.stats.files.total).toBe(1);
    expect(result.hostExitCode).toBe(0);
  });
});

describe('programmatic createRunner (build once, run many)', () => {
  /** Stats of a run where every discovered test passed. */
  const allPassed = (tests: number, files: number) => ({
    tests: { total: tests, passed: tests, failed: 0, skipped: 0, todo: 0 },
    files: { total: files, failed: 0 },
  });

  it('compiles once and reuses that build for every run()', async ({
    onTestFinished,
  }) => {
    const { cli } = await runRstestCli({
      command: 'node',
      args: ['run-runner-build-reuse.mjs'],
      onTestFinished,
      options: { nodeOptions: { cwd: fixturesDir } },
    });

    await cli.exec;
    const result = parsePayload(cli.stdout);

    // build() reports what it compiled, as absolute paths.
    expect(result.buildFiles).toEqual(['alpha.test.ts', 'beta.test.ts']);
    expect(result.buildFilesAbsolute).toBe(true);
    // One compilation covers build() + the first run...
    expect(result.compilesAfterFirstRun).toBe(1);
    // ...and the second run executes without recompiling.
    expect(result.compilesAfterSecondRun).toBe(1);
    // Positive control: the counter does move when a build really happens, so
    // "unchanged" above cannot pass just because nothing was ever counted.
    expect(result.compilesAfterSecondRunner).toBe(2);
    // Every run executed the full built set — reuse is not a partial run.
    expect(result.first).toEqual({ ok: true, stats: allPassed(3, 2) });
    expect(result.second).toEqual({ ok: true, stats: allPassed(3, 2) });
    expect(result.third).toEqual({ ok: true, stats: allPassed(3, 2) });
    expect(result.hostExitCode).toBe(0);
  });

  it('narrows within the built set per run, and never widens it', async ({
    onTestFinished,
  }) => {
    const { cli } = await runRstestCli({
      command: 'node',
      args: ['run-runner-narrowing.mjs'],
      onTestFinished,
      options: { nodeOptions: { cwd: fixturesDir } },
    });

    await cli.exec;
    const result = parsePayload(cli.stdout);

    // No run options: the whole build.
    expect(result.all).toEqual({
      ok: true,
      stats: allPassed(3, 2),
      files: ['alpha.test.ts', 'beta.test.ts'],
      passed: ['adds', 'multiplies', 'subtracts'],
    });
    // Run-scoped `filters` select files out of the same build.
    expect(result.byFile).toEqual({
      ok: true,
      stats: allPassed(2, 1),
      files: ['alpha.test.ts'],
      passed: ['adds', 'multiplies'],
    });
    // `testNamePattern` selects cases: both files still run, but only the
    // matching case executes — the rest are skipped, not dropped.
    expect(result.byName.ok).toBe(true);
    expect(result.byName.files).toEqual(['alpha.test.ts', 'beta.test.ts']);
    expect(result.byName.passed).toEqual(['adds']);
    expect(result.byName.stats).toEqual({
      tests: { total: 3, passed: 1, failed: 0, skipped: 2, todo: 0 },
      files: { total: 2, failed: 0 },
    });
    // A filter outside the built set matches nothing (it cannot add files to
    // the build), which is a failed run exactly like the CLI's "no test files".
    expect(result.outsideBuild.ok).toBe(false);
    expect(result.outsideBuild.files).toEqual([]);
    expect(result.outsideBuild.stats.tests.total).toBe(0);
    expect(result.outsideBuild.stats.files.total).toBe(0);
    // ...unless that run opted into `passWithNoTests`, which proves the
    // run-scoped override reaches the result assembly and is not lost when it
    // is restored after the cycle.
    expect(result.outsideBuildAllowed.ok).toBe(true);
    expect(result.outsideBuildAllowed.files).toEqual([]);
    expect(result.hostExitCode).toBe(0);
  });

  it('starts every run from a clean runtime, in the same reused worker (isolate: false)', async ({
    onTestFinished,
  }) => {
    const { cli } = await runRstestCli({
      command: 'node',
      args: ['run-runner-clean-runtime.mjs'],
      onTestFinished,
      options: { nodeOptions: { cwd: fixturesDir } },
    });

    await cli.exec;
    const result = parsePayload(cli.stdout);

    expect(result.first.ok).toBe(true);
    expect(result.second.ok).toBe(true);
    // Within a run the two files share the module registry (1 then 2)...
    expect(result.first.counts).toEqual([1, 2]);
    // ...and the second run sees a fresh registry rather than 3 and 4.
    expect(result.second.counts).toEqual([1, 2]);
    // The reset is a flushed runtime in the *same* worker process, not a
    // respawned pool — the whole point of keeping the pool alive between runs.
    expect(result.first.pids).toHaveLength(1);
    expect(result.second.pids).toEqual(result.first.pids);
    expect(result.hostExitCode).toBe(0);
  });

  it('runs globalSetup once per runner and its teardown at close()', async ({
    onTestFinished,
  }) => {
    const { cli } = await runRstestCli({
      command: 'node',
      args: ['run-runner-global-setup.mjs'],
      onTestFinished,
      options: { nodeOptions: { cwd: fixturesDir } },
    });

    await cli.exec;
    const result = parsePayload(cli.stdout);

    expect(result.afterFirstRun).toEqual(['setup']);
    // Three runs, still one setup: globalSetup belongs to the runner.
    expect(result.afterThirdRun).toEqual(['setup']);
    // Teardown lands at close(), after the last run's result.
    expect(result.afterClose).toEqual(['setup', 'teardown']);
    // A failing teardown rejects close() — the run that preceded it still
    // passed, and the host's exit code is restored either way.
    expect(result.lastResultOk).toBe(true);
    expect(result.closeError).toContain('globalSetup teardown failed');
    expect(result.hostExitCode).toBe(0);
  });

  it('rejects an overlapping run() or build() instead of queueing it', async ({
    onTestFinished,
  }) => {
    const { cli } = await runRstestCli({
      command: 'node',
      args: ['run-runner-serial.mjs'],
      onTestFinished,
      options: { nodeOptions: { cwd: fixturesDir } },
    });

    await cli.exec;
    const result = parsePayload(cli.stdout);

    expect(result.concurrentRunError).toBe(
      'A test run is already in progress; runs on one runner are serial.',
    );
    expect(result.concurrentBuildError).toBe(
      'Cannot build while a test run is in progress; wait for the run to finish.',
    );
    // Overlapping calls are caller misuse: the in-flight run is unaffected...
    expect(result.ok).toBe(true);
    expect(result.passed).toBe(3);
    // ...and the runner is still usable afterwards.
    expect(result.afterErrorOk).toBe(true);
    expect(result.afterErrorPassed).toBe(3);
    expect(result.hostExitCode).toBe(0);
  });

  it('rejects an explicit build() on a compile error but contains it inside run()', async ({
    onTestFinished,
  }) => {
    // The bridge generates an unparseable `.ts` file; don't leave it on disk.
    const generatedDir = join(fixturesDir, 'test-temp-broken');
    onTestFinished(() =>
      rmSync(generatedDir, { recursive: true, force: true }),
    );

    const { cli } = await runRstestCli({
      command: 'node',
      args: ['run-runner-build-error.mjs'],
      onTestFinished,
      options: { nodeOptions: { cwd: fixturesDir } },
    });

    await cli.exec;
    const result = parsePayload(cli.stdout);

    // Explicit build(): the caller asked to compile, so it rejects.
    expect(result.buildError).toContain('Test build failed.');
    // run() never rejects — the same failure arrives as an unhandled error on a
    // failed result.
    expect(result.ok).toBe(false);
    expect(result.unhandledErrors).toHaveLength(1);
    expect(result.unhandledErrors[0]).toContain('Test build failed.');
    expect(result.stats.files.total).toBe(0);
    // A failed build must not poison the embedding host either.
    expect(result.hostExitCode).toBe(0);
  });

  it('close() is idempotent and restores the host env + exit code', async ({
    onTestFinished,
  }) => {
    const { cli } = await runRstestCli({
      command: 'node',
      args: ['run-runner-close.mjs'],
      onTestFinished,
      options: { nodeOptions: { cwd: fixturesDir } },
    });

    const exec = await cli.exec;
    const result = parsePayload(cli.stdout);

    // The run itself reports the failing file.
    expect(result.ok).toBe(false);
    expect(result.failedTests).toBe(1);
    expect(result.before).toEqual({ NODE_ENV: null, RSTEST: null });
    // A live runner keeps the process in test mode (later runs spawn workers
    // that need it) and keeps the run's exit code until it is closed.
    expect(result.duringRunner).toEqual({
      env: { NODE_ENV: 'test', RSTEST: 'true' },
      exitCode: 1,
    });
    // close() puts the host's own state back — including the exit code the host
    // had set before the runner existed.
    expect(result.after).toEqual(result.before);
    expect(result.hostExitCode).toBe(3);
    expect(exec.exitCode).toBe(3);
    // A closed runner is not reusable, and the second close() was a no-op.
    expect(result.closedRunError).toBe('The test runner is closed.');
  });

  it('rejects createRunner() for a browser-mode config before starting anything', async ({
    onTestFinished,
  }) => {
    const { cli } = await runRstestCli({
      command: 'node',
      args: ['run-runner-browser.mjs'],
      onTestFinished,
      options: { nodeOptions: { cwd: fixturesDir } },
    });

    const exec = await cli.exec;
    const result = parsePayload(cli.stdout);

    // No runner is handed out, so no dev server / browser session leaks.
    expect(result.hadRunner).toBe(false);
    expect(result.createRunnerError).toContain(
      'createRunner() does not support browser mode yet',
    );
    // The guard fires before any browser is launched: the host exits cleanly
    // (and this fixture needs no browser binary at all).
    expect(result.hostExitCode).toBe(0);
    expect(exec.exitCode).toBe(0);
  });

  // Browsers are only installed for the CI rows that run browser-mode e2e; the
  // other rows exclude `browser-mode/**` on the same conditions (see
  // e2e/rstest.config.mts).
  it.skipIf(
    process.env.ISOLATE === 'false' ||
      process.env.RSTEST_POOL_TYPE === 'threads',
  )(
    'keeps the one-shot run() working for browser-mode projects',
    async ({ onTestFinished }) => {
      const { cli } = await runRstestCli({
        command: 'node',
        args: ['run-runner-browser-sugar.mjs'],
        onTestFinished,
        options: { nodeOptions: { cwd: fixturesDir } },
      });

      await cli.exec;
      const result = parsePayload(cli.stdout);

      // run() is sugar over the same runner factory, but browser projects still
      // route through the one-shot orchestrator instead of inheriting the
      // runner's fail-fast.
      expect(result.unhandledErrors).toEqual([]);
      expect(result.ok).toBe(true);
      expect(result.stats).toEqual(allPassed(2, 1));
      expect(result.hostExitCode).toBe(0);
    },
  );

  it('keeps the compiled output fixed for the runner, so a source edit needs a new runner', async ({
    onTestFinished,
  }) => {
    // The bridge writes its own sources so it can edit them between builds.
    const generatedDir = join(fixturesDir, 'test-temp-rebuild');
    onTestFinished(() =>
      rmSync(generatedDir, { recursive: true, force: true }),
    );

    const { cli } = await runRstestCli({
      command: 'node',
      args: ['run-runner-rebuild.mjs'],
      onTestFinished,
      options: { nodeOptions: { cwd: fixturesDir } },
    });

    await cli.exec;
    const result = parsePayload(cli.stdout);

    // build() is re-entrant, and re-entry resolves the same build: same entry
    // set...
    expect(result.firstBuildFiles).toEqual(['value.test.ts']);
    expect(result.secondBuildFiles).toEqual(result.firstBuildFiles);
    // ...and the same compiled output, so the edit made between the two builds
    // is not picked up by the second run.
    expect(result.firstValues).toEqual(['first']);
    expect(result.secondValues).toEqual(['first']);
    // The edit was real: a new runner compiles it. This is the documented way
    // to pick up source changes.
    expect(result.thirdValues).toEqual(['second']);
    expect(result.hostExitCode).toBe(0);
  });
});

describe('programmatic runCLI (CLI passthrough)', () => {
  it('runs the matched command from a raw process.argv-shaped array, like the bin', async ({
    onTestFinished,
  }) => {
    const { cli } = await runRstestCli({
      command: 'node',
      args: ['run-runcli.mjs'],
      onTestFinished,
      options: { nodeOptions: { cwd: fixturesDir } },
    });

    const exec = await cli.exec;
    const result = parsePayload(cli.stdout);

    // runCLI forwarded the argv through the CLI's own parser + command router,
    // ran sum.test.ts to completion, and left the CLI's exit code (0) on the
    // host without a structured return value.
    expect(result.hostExitCode).toBe(0);
    expect(exec.exitCode).toBe(0);
  });

  it('honors runCLI({ cwd }) for the init command (scaffolds into the targeted dir)', async ({
    onTestFinished,
  }) => {
    const { cli } = await runRstestCli({
      command: 'node',
      args: ['run-runcli-init-cwd.mjs'],
      onTestFinished,
      options: { nodeOptions: { cwd: fixturesDir } },
    });

    await cli.exec;
    const result = parsePayload(cli.stdout);

    expect(result.error).toBe(null);
    // init scaffolds into runCLI's `cwd`, not the bridge's own working directory.
    expect(result.scaffoldedInTarget).toBe(true);
    expect(result.leakedIntoCwd).toBe(false);
  });
});
