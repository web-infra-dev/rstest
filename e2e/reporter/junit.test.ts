import { expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

it('junit', async () => {
  const { cli, expectLog } = await runRstestCli({
    command: 'rstest',
    args: ['run', 'junit', '--reporter', 'junit'],
    options: {
      nodeOptions: {
        cwd: __dirname,
      },
    },
  });

  await cli.exec;
  expect(cli.exec.process?.exitCode).toBe(1);

  const logs = cli.stdout.split('\n').filter(Boolean);

  expectLog('<?xml version="1.0" encoding="UTF-8"?>', logs);

  expectLog('<failure', logs);
  expectLog('<skipped/>', logs);
});
