import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

it('should run css test correctly', async () => {
  const { expectExecSuccess } = await runRstestCli({
    command: 'rstest',
    args: ['run', 'test/css'],
    options: {
      nodeOptions: {
        cwd: join(__dirname, 'fixtures'),
      },
    },
  });

  await expectExecSuccess();
});
