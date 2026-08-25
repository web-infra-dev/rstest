import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from '@rstest/core';
import { runRstestCli } from '../scripts/';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('threads pool e2e', () => {
  for (const pool of ['threads', 'vmThreads'] as const) {
    it(`should run tests under the ${pool} pool`, async ({
      onTestFinished,
    }) => {
      const { expectExecSuccess } = await runRstestCli({
        command: 'rstest',
        args: ['run', '--pool', pool],
        onTestFinished,
        options: {
          nodeOptions: {
            cwd: join(__dirname, './fixtures'),
          },
        },
      });

      await expectExecSuccess();
    });
  }
});
