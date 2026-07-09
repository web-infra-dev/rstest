import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from '@rstest/core';
import { runRstestCli } from '../scripts/';

const __filename = fileURLToPath(import.meta.url);

const __dirname = dirname(__filename);

describe('test chai config', () => {
  it('should return test correct with chai config', async () => {
    const { expectExecFailed, expectLog } = await runRstestCli({
      command: 'rstest',
      args: ['run'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecFailed();
    expectLog(
      'expected [ 1, 2, [ 3, [ 4 ], { a: 1, length: 1 } ] ] to strictly equal',
    );
  });
});
