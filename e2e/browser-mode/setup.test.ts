import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareFixtures } from '../scripts';
import { describe, expect, it } from '@rstest/core';
import {
  runBrowserCli,
  runBrowserWatchCli,
  killCliProcessTree,
  deleteFixtureTarget,
} from './utils';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('browser mode - setup files', () => {
  it('should execute setup files before tests', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli('setup-files');

    await expectExecSuccess();
    expect(cli.stdout).toMatch(/Tests.*passed/);
  });

  it.each(['list', 'parallel'])(
    'runs setup files in %s order',
    async (order) => {
      const { expectExecSuccess } = await runBrowserCli('setup-files', {
        env: { SETUP_SEQUENCE: order },
      });
      await expectExecSuccess();
    },
  );

  it('collects tests after parallel setup files', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli('setup-files', {
      command: 'list',
      env: { SETUP_SEQUENCE: 'parallel' },
    });
    await expectExecSuccess();
    expect(cli.stdout).toContain('should have setup file executed');
  });

  it('reruns parallel setup files in watch mode', async () => {
    const root = join(__dirname, 'fixtures/setup-files-parallel-watch');
    const { fs } = await prepareFixtures({
      fixturesPath: join(__dirname, 'fixtures/setup-files'),
      fixturesTargetPath: root,
    });
    const { cli } = await runBrowserWatchCli('setup-files-parallel-watch', {
      args: ['tests/index.test.ts'],
      env: { SETUP_SEQUENCE: 'parallel' },
    });
    try {
      await cli.waitForStdout('Test Files 1 passed');
      await cli.waitForStdout('Waiting for file changes...');
      cli.resetStd();
      fs.update(
        join(root, 'setup.ts'),
        (source) => `${source}\nthrow new Error('PARALLEL_SETUP_RELOADED');\n`,
      );
      await cli.waitForStderr('PARALLEL_SETUP_RELOADED');
      await cli.waitForStdout('Test Files 1 failed');
      await cli.waitForStdout('Waiting for file changes...');
      cli.resetStd();
      fs.update(join(root, 'setup.ts'), (source) =>
        source.replace("throw new Error('PARALLEL_SETUP_RELOADED');", ''),
      );
      await cli.waitForStdout('Test Files 1 passed');
      expect(cli.stderr).toBe('');
    } finally {
      await killCliProcessTree(cli);
      await deleteFixtureTarget(fs, root);
    }
  });

  it.each(['single', 'multiple'])(
    'drains parallel setups after %s failure',
    async (failure) => {
      const { expectExecFailed, cli } = await runBrowserCli('setup-files', {
        args: ['tests/index.test.ts'],
        env: { SETUP_SEQUENCE: 'parallel', SETUP_FAILURE: failure },
      });
      await expectExecFailed();
      expect(cli.stdout).toContain('SECOND_SETUP_DRAINED');
      expect(cli.stdout).not.toContain('TEST_COLLECTED_AFTER_FAILED_SETUP');
      expect(cli.stderr).toContain('FIRST_SETUP_FAILURE');
    },
  );

  it('should isolate setup files in later non-isolated files', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli('setup-files', {
      args: [
        '--isolate=false',
        '--pool.maxWorkers=1',
        'tests/index.test.ts',
        'tests/second.test.ts',
      ],
    });

    await expectExecSuccess();
    expect((cli.stdout.match(/RSTEST_SETUP_BEFORE_EACH_1/g) ?? []).length).toBe(
      2,
    );
  });
});
