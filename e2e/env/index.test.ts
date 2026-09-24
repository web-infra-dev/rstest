import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from '@rstest/core';
import { runRstestCli } from '../scripts/';

const __filename = fileURLToPath(import.meta.url);

const __dirname = dirname(__filename);

const colorTestSpawnEnv = {
  CI: 'true',
};

describe('test environment variables', () => {
  it('should get environment variables correctly in test', async () => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'index.test.ts'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecSuccess();
  });

  it('should pass through NO_COLOR when user sets it', async ({
    onTestFinished,
  }) => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'noColor.test.ts'],
      onTestFinished,
      // Explicitly unset FORCE_COLOR to test that rstest doesn't add it
      unsetEnv: ['FORCE_COLOR'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
          env: {
            // User sets NO_COLOR=1 to disable colors
            NO_COLOR: '1',
          },
        },
      },
    });

    await expectExecSuccess();
  });

  it.each([
    [
      'forks',
      'config-color-projects',
      ['run', '--pool', 'forks', '--isolate=false', '--pool.maxWorkers', '1'],
    ],
    [
      'threads',
      'config-color-projects',
      ['run', '--pool', 'threads', '--isolate=false', '--pool.maxWorkers', '1'],
    ],
  ] satisfies [string, string, string[]][])(
    'should preserve configured color env in the %s pool (%s, case %#)',
    async (_pool, fixtureDir, args) => {
      const { expectExecSuccess } = await runRstestCli({
        command: 'rstest',
        args,
        unsetEnv: ['FORCE_COLOR', 'NO_COLOR'],
        options: {
          nodeOptions: {
            cwd: join(__dirname, 'fixtures', fixtureDir),
            env: colorTestSpawnEnv,
          },
        },
      });

      await expectExecSuccess();
    },
  );

  it.each(['forks', 'threads'] as const)(
    'should keep project NODE_OPTIONS task-scoped in the %s pool',
    async (pool) => {
      const { expectExecSuccess } = await runRstestCli({
        command: 'rstest',
        args: ['run', 'taskScopedNodeOptions.test.ts', '--pool', pool],
        unsetEnv: ['NODE_OPTIONS'],
        options: {
          nodeOptions: {
            cwd: join(__dirname, 'fixtures', 'config-node-options'),
          },
        },
      });

      await expectExecSuccess();
    },
  );
});
