import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it } from '@rstest/core';
import { runRstestCli } from '../../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

it('unmock works', async () => {
  const { cli, expectExecSuccess } = await runRstestCli({
    command: 'rstest',
    args: ['run'],
    options: {
      nodeOptions: {
        cwd: join(__dirname, '../fixtures/unmock'),
      },
    },
  });

  await cli.exec;
  await expectExecSuccess();
});
