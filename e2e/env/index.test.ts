import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from '@rstest/core';
import { runRstestCli } from '../scripts/';

const __filename = fileURLToPath(import.meta.url);

const __dirname = dirname(__filename);

const colorTestSpawnEnv = {
  CI: 'true',
  RSTEST_NO_AGENT: '1',
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

  it('should pass FORCE_COLOR to worker process when user sets it', async ({
    onTestFinished,
  }) => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'forceColor.test.ts'],
      onTestFinished,
      // Explicitly unset NO_COLOR to avoid conflicts
      unsetEnv: ['NO_COLOR'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
          env: {
            // User explicitly sets FORCE_COLOR=1
            FORCE_COLOR: '1',
          },
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
      'config-no-color',
      ['run', 'configNoColor.test.ts', '--pool', 'forks'],
    ],
    [
      'threads',
      'config-no-color',
      ['run', 'configNoColor.test.ts', '--pool', 'threads'],
    ],
    ['forks', 'config-color-projects', ['run', '--pool', 'forks']],
  ] satisfies [string, string, string[]][])(
    'should preserve configured color env in the %s pool (%s)',
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

  it('should propagate color env correctly without user overrides', async ({
    onTestFinished,
  }) => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'defaultColor.test.ts'],
      onTestFinished,
      // Unset both color envs to test default behavior
      unsetEnv: ['FORCE_COLOR', 'NO_COLOR'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecSuccess();
  });
});
