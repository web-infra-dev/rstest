import { join } from 'node:path';
import { it } from '@rstest/core';
import { runRstestCli } from '../../scripts/';

it.skipIf(process.platform === 'win32')(
  'should catch signal exit correctly when signal listener exists',
  async () => {
    const { expectExecFailed, expectLog } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'signalListener.test.ts'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });
    await expectExecFailed();

    expectLog(/Rstest exited unexpectedly with code 0/);
  },
);
