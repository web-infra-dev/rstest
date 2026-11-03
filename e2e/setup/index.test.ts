import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { prepareFixtures, runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('test setup file', async () => {
  it('should run setup file correctly', async () => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures/basic'),
        },
      },
    });

    await expectExecSuccess();
    const logs = cli.stdout
      .split('\n')
      .filter((log) => log.startsWith('[afterAll]'));
    expect(logs).toEqual(['[afterAll] setup']);
  });

  it.each(['list', 'parallel'] as const)(
    'runs setup files in %s order',
    async (order) => {
      const { expectExecSuccess } = await runRstestCli({
        command: 'rstest',
        args: ['run'],
        options: {
          nodeOptions: {
            cwd: join(__dirname, 'fixtures/basic'),
            env: { SETUP_SEQUENCE: order },
          },
        },
      });
      await expectExecSuccess();
    },
  );

  for (const federation of [false, true]) {
    it.each(['forks', 'threads', 'vmForks', 'vmThreads'] as const)(
      `runs parallel setup files with %s (federation: ${federation})`,
      async (pool) => {
        const { expectExecSuccess } = await runRstestCli({
          command: 'rstest',
          args: ['run', '--pool.type', pool],
          options: {
            nodeOptions: {
              cwd: join(__dirname, 'fixtures/basic'),
              env: {
                SETUP_SEQUENCE: 'parallel',
                SETUP_FEDERATION: String(federation),
              },
            },
          },
        });
        await expectExecSuccess();
      },
    );
  }

  it('collects tests after parallel setup files', async () => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['list'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures/basic'),
          env: { SETUP_SEQUENCE: 'parallel' },
        },
      },
    });
    await expectExecSuccess();
    expect(cli.stdout).toContain('waits for setup files');
  });

  it('reruns parallel setup files in watch mode', async () => {
    const root = join(__dirname, 'fixtures/basic-parallel-watch');
    const { fs } = await prepareFixtures({
      fixturesPath: join(__dirname, 'fixtures/basic'),
      fixturesTargetPath: root,
    });
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['watch', '--testNamePattern', 'waits for setup files'],
      options: {
        nodeOptions: { cwd: root, env: { SETUP_SEQUENCE: 'parallel' } },
      },
    });
    try {
      await cli.waitForStdout('Test Files 1 passed');
      await cli.waitForStdout('Waiting for file changes...');
      cli.resetStd();
      fs.update(
        join(root, 'sequence-first.ts'),
        (source) => `${source}\nconsole.log('PARALLEL_SETUP_RELOADED');\n`,
      );
      await cli.waitForStdout('PARALLEL_SETUP_RELOADED');
      await cli.waitForStdout('Test Files 1 passed');
      expect(cli.stderr).toBe('');
    } finally {
      await cli.killProcessTree();
      fs.delete(root);
    }
  });

  it.each(['single', 'multiple'])(
    'drains parallel setups after %s failure',
    async (failure) => {
      const { cli, expectExecFailed } = await runRstestCli({
        command: 'rstest',
        args: ['run'],
        options: {
          nodeOptions: {
            cwd: join(__dirname, 'fixtures/basic'),
            env: { SETUP_SEQUENCE: 'parallel', SETUP_FAILURE: failure },
          },
        },
      });
      await expectExecFailed();
      expect(cli.stdout).toContain('SECOND_SETUP_DRAINED');
      expect(cli.stdout).not.toContain('TEST_COLLECTED_AFTER_FAILED_SETUP');
      expect(cli.stderr).toContain('FIRST_SETUP_FAILURE');
    },
  );

  it('should test error when run setup file failed', async () => {
    const { expectExecFailed, expectStderrLog } = await runRstestCli({
      command: 'rstest',
      args: ['run'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures/error'),
        },
      },
    });

    await expectExecFailed();
    // test error log
    expectStderrLog(/Rstest setup error/);
    expectStderrLog(/rstest.setup.ts:1:7/);
  });

  it('should run setup file correctly when setupFiles value is package name', async () => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures/package-name'),
        },
      },
    });
    await expectExecSuccess();
  });

  it('should resolve setup file correctly when setupFiles path with file protocol', async () => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', '-c', 'rstest.fileProtocol.config.mts'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures/package-name'),
        },
      },
    });
    await expectExecSuccess();
  });

  it('should resolve setup file correctly when setupFile is pure es module', async () => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', '-c', 'rstest.esm.config.mts'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures/package-name'),
        },
      },
    });
    await expectExecSuccess();
  });

  it('should run setup file correctly with no-isolate', async () => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures/no-isolate'),
        },
      },
    });

    await expectExecSuccess();
    const logs = cli.stdout.split('\n');

    // `ctx.filepath` is OS-native (#1465), so build the expected suffix with
    // `join` to match backslashes on Windows and forward slashes on POSIX.
    expect(
      logs.filter((log) => log.endsWith(join('no-isolate', 'foo.test.ts'))),
    ).toHaveLength(1);
    expect(
      logs.filter((log) => log.endsWith(join('no-isolate', 'bar.test.ts'))),
    ).toHaveLength(1);
    expect(logs.filter((log) => log.endsWith('[beforeAll] root'))).toHaveLength(
      2,
    );
    expect(logs.filter((log) => log.endsWith('[afterAll] setup'))).toHaveLength(
      2,
    );
  });
});
