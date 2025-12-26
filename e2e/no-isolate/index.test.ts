import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from '@rstest/core';
import { runRstestCli } from '../scripts/';

const __filename = fileURLToPath(import.meta.url);

const __dirname = dirname(__filename);

describe('test isolate false', () => {
  it('should collect test correctly when no isolate', async ({
    onTestFinished,
  }) => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['list', '--isolate', 'false'],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: join(__dirname, '../'),
        },
      },
    });

    await expectExecSuccess();
  });
});
