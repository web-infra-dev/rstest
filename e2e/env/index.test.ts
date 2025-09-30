import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from '@rstest/core';
import { join } from 'pathe';
import { runRstestCli } from '../scripts/';

const __filename = fileURLToPath(import.meta.url);

const __dirname = dirname(__filename);

describe('test environment variables', () => {
  it('should get environment variables correctly in test', async () => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'index.test.ts'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecSuccess();
  });
});
