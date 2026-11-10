import { fileURLToPath } from 'node:url';
import { expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const cwd = fileURLToPath(new URL('./fixtures/prebundle', import.meta.url));

it.for(['forks', 'threads', 'vmForks', 'vmThreads'])(
  'shares bundled jsdom imports under %s',
  async (pool, { onTestFinished }) => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--config', 'rstest.shared.config.mts', '--pool', pool],
      options: { nodeOptions: { cwd } },
      onTestFinished,
    });
    await expectExecSuccess();
  },
);

it.for(['build', 'load'])(
  'keeps require and import usable after prebundle %s failure',
  async (failure, { onTestFinished }) => {
    const preload = fileURLToPath(
      new URL('./fixtures/prebundle/fail-prebundle.cjs', import.meta.url),
    );
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--config', 'rstest.shared.config.mts'],
      options: {
        nodeOptions: {
          cwd,
          env: {
            PREBUNDLE_FAILURE: failure,
            NODE_OPTIONS: `--require=${JSON.stringify(preload)}`,
          },
        },
      },
      onTestFinished,
    });
    await expectExecSuccess();
    expect(cli.log).toContain('falling back to its native entry');
  },
);

it.for(['list', 'commonjs', 'shared-worker'])(
  'shares jsdom during %s',
  async (mode, { onTestFinished }) => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: [
        mode === 'list' ? 'list' : 'run',
        '--config',
        'rstest.shared.config.mts',
        ...(mode === 'commonjs' ? ['--output.module', 'false'] : []),
        ...(mode === 'shared-worker'
          ? ['--isolate', 'false', '--pool.maxWorkers', '1']
          : []),
      ],
      options: { nodeOptions: { cwd } },
      onTestFinished,
    });
    await expectExecSuccess();
  },
);
