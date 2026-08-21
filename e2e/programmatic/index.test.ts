import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { parseMarkerPayload, runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesDir = join(__dirname, 'fixtures');

const parsePayload = (stdout: string) =>
  parseMarkerPayload<Record<string, any>>(stdout, '__RSTEST_API_RESULT__');

describe('programmatic createRstest', () => {
  it('runs disk tests via config + returns nested stats', async ({
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

  it('accepts config + virtual modules plugin (Midscene shape)', async ({
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

  it('supports reusable runners and contains build/config failures', async ({
    onTestFinished,
  }) => {
    const { cli } = await runRstestCli({
      command: 'node',
      args: ['run-lifecycle.mjs'],
      onTestFinished,
      options: { nodeOptions: { cwd: fixturesDir } },
    });

    await cli.exec;
    const result = parsePayload(cli.stdout);

    expect(result.context).toEqual({
      root: join(fixturesDir, 'disk'),
      include: ['sum.test.ts'],
      projects: [],
    });
    expect(result.factoryCalls).toBe(3);
    expect(result.reporterFiles).toBe(3);
    expect(result.oneShot).toEqual({ ok: true, tests: 2 });
    expect(result.buildFiles).toEqual(['sum.test.ts']);
    expect(result.narrowed).toEqual({
      total: 2,
      passed: 1,
      failed: 0,
      skipped: 1,
      todo: 0,
    });
    expect(result.restored).toEqual({
      total: 2,
      passed: 2,
      failed: 0,
      skipped: 0,
      todo: 0,
    });
    expect(result.outsideBuild).toEqual({ ok: true, files: 0 });
    expect(result.runnerCycles[0]).toEqual(
      expect.arrayContaining(['failing.test.ts', 'sum.test.ts']),
    );
    expect(result.runnerCycles[1]).toEqual(['sum.test.ts']);
    expect(result.filteredCycle).toEqual({
      ok: true,
      files: ['sum.test.ts'],
    });
    expect(result.blobRunnerError).toBe(
      'createRunner() does not support the blob reporter. Use run() to generate a one-shot blob report.',
    );
    expect(result.errors).toEqual({
      beforeBuild: 'Rstest runner must be built before run().',
      secondBuild: 'Rstest runner has already been built.',
      afterClose: 'Rstest runner is closed.',
    });
    expect(result.oneShotBuildFailure.ok).toBe(false);
    expect(result.oneShotBuildFailure.message).toContain(
      'programmatic build exploded',
    );
    expect(result.runnerBuildFailure).toContain('programmatic build exploded');
    expect(result.runtimeFailure).toEqual({
      ok: false,
      message: 'runtime config exploded',
      snapshotPresent: false,
    });
    expect(result.teardownFailure).toEqual({
      runOk: true,
      closeErrors: ['Global teardown failed.', 'Global teardown failed.'],
    });
    expect(result.globalSetupFailure.first).toEqual({
      ok: false,
      files: 0,
      tests: 0,
      message: 'Global setup failed intentionally',
    });
    expect(result.globalSetupFailure.second).toEqual({
      ok: false,
      files: 0,
      tests: 0,
      message:
        'Global setup has already failed for this runner. Create a new runner to retry global setup. Original error: Global setup failed intentionally',
      cause: 'Global setup failed intentionally',
    });
  });

  it('isolates exit codes, worker env, and teardown by context', async ({
    onTestFinished,
  }) => {
    const { cli } = await runRstestCli({
      command: 'node',
      args: ['run-host-safety.mjs'],
      onTestFinished,
      options: { nodeOptions: { cwd: fixturesDir } },
    });

    const execution = await cli.exec;
    const result = parsePayload(cli.stdout);

    expect(execution.exitCode).toBe(0);
    expect(result.results).toEqual([true, true]);
    expect(result.observedMutations).toEqual([]);
    expect(result.successHostState).toEqual({
      value: 'host-value',
      deleted: 'host-delete',
      exitCode: 9,
    });
    expect(result.failure).toEqual({
      ok: false,
      hostExitCode: 0,
      observedMutation: false,
    });
    expect(result.teardownEntries).toEqual(['context-a', 'context-b']);
  });

  it('loads a disk config factory without applying extends twice', async ({
    onTestFinished,
  }) => {
    const { cli } = await runRstestCli({
      command: 'node',
      args: ['run-config-factory.mjs'],
      onTestFinished,
      options: { nodeOptions: { cwd: fixturesDir } },
    });

    const execution = await cli.exec;
    const result = parsePayload(cli.stdout);

    expect(execution.exitCode).toBe(0);
    expect(result).toEqual({
      ok: true,
      tests: 1,
      factoryCalls: 2,
      extendsCalls: 2,
    });
  });

  it('lists tests with project metadata and ignores shard', async ({
    onTestFinished,
  }) => {
    const { cli } = await runRstestCli({
      command: 'node',
      args: ['run-list.mjs'],
      onTestFinished,
      options: { nodeOptions: { cwd: fixturesDir } },
    });

    const execution = await cli.exec;
    const result = parsePayload(cli.stdout);

    expect(execution.exitCode).toBe(0);
    expect(result.context).toEqual({
      rootMatches: true,
      projects: [
        { name: 'alpha', root: 'alpha' },
        { name: 'beta', root: 'beta' },
      ],
    });
    expect(result.files).toEqual([
      { file: 'alpha.test.ts', project: 'alpha', type: 'file' },
      { file: 'beta.test.ts', project: 'beta', type: 'file' },
    ]);
    expect(result.filtered).toEqual(['alpha.test.ts']);
    expect(result.collectionError).toBe('Failed to list tests.');
    expect(result.skippedDeclarations).toEqual([
      {
        file: 'only-skipped.test.ts',
        name: 'skipped case',
        taskName: 'skipped case',
        parentNames: [],
        runMode: 'skip',
        type: 'case',
      },
      {
        file: 'todo.test.ts',
        name: 'todo case',
        taskName: 'todo case',
        parentNames: [],
        runMode: 'todo',
        type: 'case',
      },
    ]);
    expect(result.listed).toEqual([
      {
        file: 'alpha.test.ts',
        name: 'shared suite',
        taskName: 'shared suite',
        parentNames: [],
        project: 'alpha',
        location: { line: 4, column: 9 },
        type: 'suite',
      },
      {
        file: 'alpha.test.ts',
        name: 'shared suite > shared case',
        taskName: 'shared case',
        parentNames: ['shared suite'],
        project: 'alpha',
        location: { line: 5, column: 5 },
        type: 'case',
      },
      {
        file: 'beta.test.ts',
        name: 'shared suite',
        taskName: 'shared suite',
        parentNames: [],
        project: 'beta',
        location: { line: 4, column: 9 },
        type: 'suite',
      },
      {
        file: 'beta.test.ts',
        name: 'shared suite > shared case',
        taskName: 'shared case',
        parentNames: ['shared suite'],
        project: 'beta',
        location: { line: 5, column: 5 },
        type: 'case',
      },
    ]);
  });

  it('reports watch results per cycle and closes with teardown', async ({
    onTestFinished,
  }) => {
    const { cli } = await runRstestCli({
      command: 'node',
      args: ['run-watch.mjs'],
      onTestFinished,
      options: { nodeOptions: { cwd: fixturesDir } },
    });

    const execution = await cli.exec;
    const result = parsePayload(cli.stdout);

    expect(execution.exitCode).toBe(0);
    expect(result.cycles).toHaveLength(2);
    expect(result.cycles[0]).toEqual({
      ok: true,
      files: expect.arrayContaining(['first.test.ts', 'second.test.ts']),
      tests: 2,
    });
    expect(result.cycles[0].files).toHaveLength(2);
    expect(result.cycles[1]).toEqual({
      ok: true,
      files: ['first.test.ts'],
      tests: 1,
    });
    expect(result.emptyFilterCycles).toEqual({ fuzzy: [], exact: [] });
    expect(result.zeroMatchCycles[0]).toEqual([]);
    expect(result.zeroMatchCycles.at(-1)).toEqual(['added.test.ts']);
    expect(result.updateOptions).toEqual({
      run: {
        falseOk: false,
        falseCreatedSnapshot: false,
        undefinedOk: true,
        undefinedCreatedSnapshot: true,
      },
      watch: {
        falseOk: false,
        falseCreatedSnapshot: false,
        undefinedOk: true,
        undefinedCreatedSnapshot: true,
      },
    });
    expect(result.teardownFailure).toEqual({
      runOk: true,
      closeErrors: ['Global teardown failed.', 'Global teardown failed.'],
    });
    expect(result.selectorRejections).toEqual({
      related:
        'watch() does not support the `related` or `changed` options. Use run() for a one-shot related run.',
      changed:
        'watch() does not support the `related` or `changed` options. Use run() for a one-shot related run.',
    });
    expect(result.configCallsAfterRejections).toBe(1);
    expect(result.teardown).toEqual(['teardown']);
  });

  it('runs browser tests and rejects unsupported browser lifecycles', async ({
    onTestFinished,
  }) => {
    const { cli } = await runRstestCli({
      command: 'node',
      args: ['run-browser.mjs'],
      onTestFinished,
      options: { nodeOptions: { cwd: fixturesDir } },
    });

    const execution = await cli.exec;
    const result = parsePayload(cli.stdout);

    expect(execution.exitCode).toBe(0);
    expect(result).toEqual({
      ok: true,
      tests: 1,
      file: 'browser.test.ts',
      errors: [],
      rejections: {
        runner:
          'createRunner() does not support browser mode. Use run() instead.',
        watch: 'watch() does not support browser mode yet. Use run() instead.',
      },
    });
  });
});
