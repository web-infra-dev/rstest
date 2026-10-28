import { expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

it.each(['default', 'stack', 'list'])(
  'runs hooks in %s order',
  async (hooks) => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', '-c', 'rstest.sequence.config.mts'],
      options: {
        nodeOptions: { cwd: __dirname, env: { HOOK_ORDER: hooks } },
      },
    });

    await expectExecSuccess();
    expect(cli.stdout).toContain(
      `HOOK_ORDER_OK:${hooks === 'list' ? 'list' : 'stack'}`,
    );
  },
);
