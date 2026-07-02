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
});

describe('programmatic runCli', () => {
  it('runs only related test files for a source file (jest findRelatedTests parity)', async ({
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
