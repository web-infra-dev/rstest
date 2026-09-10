import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { BROWSER_PORTS } from '../browser-mode/fixtures/ports';
import { parseMarkerPayload, runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesDir = join(__dirname, 'fixtures');

const parsePayload = (stdout: string) =>
  parseMarkerPayload<Record<string, any>>(stdout, '__RSTEST_API_RESULT__');

describe('programmatic createRstest', () => {
  it.for(['forks', 'vmThreads'] as const)(
    'uses inline config and rejects build failures with %s',
    async (pool, { onTestFinished }) => {
      const { cli } = await runRstestCli({
        command: 'node',
        args: ['run-inline.mjs', pool],
        onTestFinished,
        options: { nodeOptions: { cwd: fixturesDir } },
      });

      await cli.exec;
      const result = parsePayload(cli.stdout);

      expect(result.context).toEqual({
        rootPath: join(fixturesDir, 'disk'),
        include: ['*.test.ts'],
        projects: [
          {
            name: 'rstest',
            rootPath: join(fixturesDir, 'disk'),
          },
        ],
      });
      expect(result.reporterFiles).toBe(1);
      expect(result.pool).toMatchObject({
        type: pool,
        maxWorkers: 1,
        memoryLimit: '256MB',
      });
      expect(result.status).toBe('pass');
      expect(result.summary).toEqual({
        tests: { total: 2, passed: 2, failed: 0, skipped: 0, todo: 0 },
        files: { total: 1, failed: 0 },
      });
      expect(result.files).toEqual([
        { status: 'pass', testPath: 'sum.test.ts' },
      ]);
      expect(result.unhandledErrors).toEqual([]);
      expect(result.duration.hasTotal).toBe(true);
      expect(result.snapshotPresent).toBe(true);
      expect(result.buildFailure.status).toBe('rejected');
      expect(result.buildFailure.message).toContain(
        'programmatic build exploded',
      );
    },
  );

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

    expect(result.status).toBe('pass');
    expect(result.summary.tests.passed).toBe(1);
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

    expect(result.status).toBe('pass');
    expect(result.contextProjects).toEqual([
      {
        name: 'rstest',
        rootPath: join(fixturesDir, 'disk'),
      },
    ]);
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

  it('isolates exit codes, worker env, and teardown by context', async ({
    onTestFinished,
  }) => {
    const { cli } = await runRstestCli({
      command: 'node',
      args: ['run-host-safety.mjs'],
      onTestFinished,
      unsetEnv: ['RSTEST'],
      options: {
        nodeOptions: {
          cwd: fixturesDir,
          env: { NODE_ENV: 'production' },
        },
      },
    });

    const execution = await cli.exec;
    const result = parsePayload(cli.stdout);

    expect(execution.exitCode).toBe(0);
    expect(result.results).toEqual(['pass', 'pass']);
    expect(result.initializedEnv).toEqual({
      RSTEST: 'true',
      NODE_ENV: 'production',
    });
    expect(result.reusedWorkerDeletion).toBe(true);
    expect(result.observedMutations).toEqual([]);
    expect(result.successHostState).toEqual({
      value: 'host-value',
      deleted: 'host-delete',
      exitCode: 9,
    });
    expect(result.failure).toEqual({
      status: 'fail',
      summary: {
        tests: { failed: 1 },
        files: { failed: 1 },
      },
      hostExitCode: 0,
      observedMutation: false,
    });
    expect(result.teardownEntries).toEqual(['context-a', 'context-b']);
  });

  it('reports missing dependencies without prompting embedded callers', async ({
    onTestFinished,
  }) => {
    const { cli } = await runRstestCli({
      command: 'node',
      args: ['run-missing-dependencies.mjs'],
      onTestFinished,
      unsetEnv: ['CI'],
      options: {
        nodeOptions: { cwd: fixturesDir, env: { NO_COLOR: '1' } },
      },
    });

    const execution = await cli.exec;
    const result = parsePayload(cli.stdout);
    const dependencyMessage =
      'Failed to load coverage provider module: @rstest/coverage-istanbul';

    expect(execution.exitCode).toBe(0);
    expect(result.run).toMatchObject({ status: 'rejected' });
    expect(result.run.message).toContain(dependencyMessage);
    expect(result.watch.message).toContain(dependencyMessage);
    expect(result.mergeReports).toMatchObject({ status: 'rejected' });
    expect(result.mergeReports.message).toContain(dependencyMessage);
    expect(cli.log).not.toContain('Install it now?');
    expect(cli.log).not.toContain('Installing ');
  });

  it('prompts for missing coverage dependencies through runCLI in a TTY host', async ({
    onTestFinished,
  }) => {
    const { cli, expectExecFailed } = await runRstestCli({
      command: 'node',
      args: ['run-cli-missing-dependencies.mjs'],
      onTestFinished,
      unsetEnv: ['CI'],
      options: { nodeOptions: { cwd: fixturesDir, env: { NO_COLOR: '1' } } },
    });
    await cli.waitForStdout('Install it now?');
    expect(cli.stdout).toContain('@rstest/coverage-istanbul');
    cli.exec.process!.stdin!.write('n\r');
    await expectExecFailed();
    expect(cli.log).not.toContain('Installing ');
  });

  it('accepts a loaded disk config without resolving extends twice', async ({
    onTestFinished,
  }) => {
    const { cli } = await runRstestCli({
      command: 'node',
      args: ['run-loaded-config.mjs'],
      onTestFinished,
      options: { nodeOptions: { cwd: fixturesDir } },
    });

    const execution = await cli.exec;
    const result = parsePayload(cli.stdout);

    expect(execution.exitCode).toBe(0);
    expect(result).toEqual({
      status: 'pass',
      tests: 1,
      extendsCalls: 1,
    });
  });

  it('lists tests with project metadata and honors explicit shard', async ({
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
    const outputWithoutShardBanners = cli.stdout
      .split('\n')
      .filter((line) => !line.startsWith('Running shard '))
      .filter(Boolean)
      .join('\n');
    expect(outputWithoutShardBanners).toBe(
      `__RSTEST_API_RESULT__${JSON.stringify(result)}__END__`,
    );
    expect(result.context).toEqual({
      rootPathMatches: true,
      projects: [
        { name: 'alpha', rootPath: 'alpha' },
        { name: 'beta', rootPath: 'beta' },
      ],
    });
    expect(result.files).toEqual([
      { testPath: 'beta.test.ts', project: 'beta', type: 'file' },
    ]);
    expect(result.filtered).toEqual(['alpha.test.ts']);
    expect(result.teardownError).toEqual({
      isListTestsError: false,
      message: 'Failed to list tests.',
    });
    expect(result.collectionError).toMatchObject({
      isListTestsError: true,
      name: 'ListTestsError',
      message: 'Failed to list tests.',
      files: [
        {
          testPath: 'collection-error.test.ts',
          errors: [{ message: 'collection failed from helper' }],
        },
      ],
      unhandledErrors: [],
    });
    expect(result.collectionError.files[0].errors[0].stack).toContain(
      'error-source.ts:1',
    );
    expect(
      result.collectionError.files[0].errors[0].stack.split('\n')[1],
    ).toContain(`${join('fixtures-collection-error', 'error-source.ts')}:1:7)`);
    expect(result.skippedDeclarations).toEqual([
      {
        testPath: 'only-skipped.test.ts',
        name: 'skipped case',
        fullName: 'skipped case',
        parentNames: [],
        project: 'rstest',
        runMode: 'skip',
        type: 'case',
      },
      {
        testPath: 'todo.test.ts',
        name: 'todo case',
        fullName: 'todo case',
        parentNames: [],
        project: 'rstest',
        runMode: 'todo',
        type: 'case',
      },
    ]);
    // Pin the depth-first declaration order consumed by structured clients.
    expect(result.listed).toEqual([
      {
        testPath: 'alpha.test.ts',
        name: 'shared suite',
        fullName: 'shared suite',
        parentNames: [],
        project: 'alpha',
        location: { line: 4, column: 9 },
        type: 'suite',
      },
      {
        testPath: 'alpha.test.ts',
        name: 'shared case',
        fullName: 'shared suite > shared case',
        parentNames: ['shared suite'],
        project: 'alpha',
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
      status: 'pass',
      files: expect.arrayContaining(['first.test.ts', 'second.test.ts']),
      tests: 2,
    });
    expect(result.cycles[0].files).toHaveLength(2);
    expect(result.cycles[1]).toEqual({
      status: 'pass',
      files: ['first.test.ts'],
      tests: 1,
    });
    expect(result.emptyFilterFiles).toEqual([]);
    expect(result.zeroMatchCycles[0]).toEqual([]);
    expect(result.zeroMatchCycles.at(-1)).toEqual(['added.test.ts']);
    expect(result.emptyProjectCycles[0]).toEqual([]);
    expect(result.emptyProjectCycles.at(-1)).toEqual(['first.test.ts']);
    expect(result.updateOptions).toEqual({
      run: {
        false: { status: 'fail', createdSnapshot: false },
        undefined: { status: 'pass', createdSnapshot: true },
      },
      watch: {
        false: { status: 'fail', createdSnapshot: false },
        undefined: { status: 'pass', createdSnapshot: true },
      },
    });
    expect(result.teardownFailure).toEqual({
      run: { status: 'pass' },
      closeErrors: ['Global teardown failed.', 'Global teardown failed.'],
    });
    expect(result.selectorRejections).toEqual({
      related:
        'watch() does not support the `related` or `changed` options. Use run() for a one-shot related run.',
      changed:
        'watch() does not support the `related` or `changed` options. Use run() for a one-shot related run.',
    });
    expect(result.teardown).toEqual(['teardown']);
  });

  it('delivers executor rerun rejections as error results and recovers', async ({
    onTestFinished,
  }) => {
    const { cli } = await runRstestCli({
      command: 'node',
      args: ['run-watch-error.mjs'],
      onTestFinished,
      options: { nodeOptions: { cwd: fixturesDir } },
    });
    const execution = await cli.exec;
    const { cycles } = parsePayload(cli.stdout);
    expect(execution.exitCode).toBe(0);
    expect(cycles.map((cycle: { status: string }) => cycle.status)).toEqual([
      'pass',
      'error',
      'pass',
    ]);
    expect(cycles[1].errors).toHaveLength(1);
    expect(cycles[1].errors[0].stack).toContain('getRsbuildStats');
  });

  it('rejects mixed watch when the browser cannot boot and closes the node server', async ({
    onTestFinished,
  }) => {
    const { cli } = await runRstestCli({
      command: 'node',
      args: [
        'run-mixed-watch-startup-error.mjs',
        String(BROWSER_PORTS['programmatic-runner']),
      ],
      onTestFinished,
      options: { nodeOptions: { cwd: fixturesDir } },
    });
    const execution = await cli.exec;
    const result = parsePayload(cli.stdout);
    expect(execution.exitCode).toBe(0);
    expect(result.rejection).toContain('missing-browser');
    expect(result.nodeServerClosed).toBe(true);
  });

  it('watches browser tests and rejects startup when globalSetup fails', async ({
    onTestFinished,
  }) => {
    const { cli } = await runRstestCli({
      command: 'node',
      args: ['run-browser.mjs', String(BROWSER_PORTS['programmatic-runner'])],
      onTestFinished,
      options: { nodeOptions: { cwd: fixturesDir } },
    });

    const execution = await cli.exec;
    const result = parsePayload(cli.stdout);

    expect(execution.exitCode).toBe(0);
    expect(result).toMatchObject({
      status: 'pass',
      tests: 1,
      file: 'browser.test.ts',
      errors: [],
      setupRejection: expect.stringContaining('Browser globalSetup failed'),
      buildFailure: {
        status: 'error',
        errors: [
          expect.stringContaining('Browser compilation failed intentionally'),
        ],
      },
      cycles: [
        { status: 'pass', tests: 1, errors: [] },
        { status: 'pass', tests: 1, errors: [] },
      ],
    });
    expect(result.emptyProjectCycles[0]).toEqual({
      status: 'pass',
      files: [],
      errors: [],
    });
    expect(result.startupCompiledAtResult).toBe(true);
    expect(result.emptyProjectCycles.at(-1)).toEqual({
      status: 'pass',
      files: ['added.test.ts'],
      errors: [],
    });
    expect(cli.stdout).toContain('Waiting for file changes...');
    expect(cli.stdout).not.toContain('press h');
  });
});
