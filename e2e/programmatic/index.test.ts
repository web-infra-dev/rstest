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

  it('config callback receives the disk config and transforms it', async ({
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

    // Disk config included a.test.ts + b.test.ts; the callback narrowed
    // `include` to a.test.ts, so only it runs (the returned config replaces
    // the disk config rather than merging onto it).
    expect(result.ok).toBe(true);
    expect(result.files).toEqual([{ status: 'pass', testPath: 'a.test.ts' }]);
    expect(result.stats.files.total).toBe(1);
  });

  it('restores host process.env after the instance is closed', async ({
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
    // While the instance is live, workers observe test-mode env.
    expect(result.during).toEqual({ NODE_ENV: 'test', RSTEST: 'true' });
    // close() puts the host environment back the way it found it.
    expect(result.after).toEqual(result.before);
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
