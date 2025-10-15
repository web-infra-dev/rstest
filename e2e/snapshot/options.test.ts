import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

it('snapshotFormat', async () => {
  const { expectExecSuccess } = await runRstestCli({
    command: 'rstest',
    args: [
      'run',
      'fixtures/options.test.ts',
      '-c',
      'fixtures/rstest.options.config.ts',
    ],
    options: {
      nodeOptions: {
        cwd: __dirname,
      },
    },
  });

  await expectExecSuccess();
});
