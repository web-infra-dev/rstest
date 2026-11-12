import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

it.for(['forks', 'threads', 'vmForks', 'vmThreads'] as const)(
  'applies expect config and formats assertion messages in %s',
  async (pool) => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--pool', pool],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures/config'),
        },
      },
    });

    await expectExecSuccess();
  },
);
