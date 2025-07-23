import { join } from 'node:path';
import { expect, it } from '@rstest/core';
import { runRstestCli } from '../../scripts/';

it('should exit correctly when signal listener exists', async () => {
  const { cli, expectExecSuccess } = await runRstestCli({
    command: 'rstest',
    args: ['run', 'signalListener.test.ts'],
    options: {
      nodeOptions: {
        cwd: join(__dirname, 'fixtures'),
      },
    },
  });
  await expectExecSuccess();

  const logs = cli.stdout.split('\n').filter(Boolean);

  expect(logs.find((log) => log.includes('Test Files 1 passed'))).toBeDefined();
});
