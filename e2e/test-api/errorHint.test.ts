import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('Test error hints', () => {
  it('should show jest error hint', async () => {
    const { expectExecFailed, expectLog } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/jestError.test.ts'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });
    await expectExecFailed();
    expectLog('jest is not defined. Did you mean rstest?');
  });
});
