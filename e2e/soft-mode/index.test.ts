import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from '@rstest/core';
import { runRstestCli } from '../scripts/';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('experiments.softMode', () => {
  it('reuses workers across files while resetting per-file env state', async ({
    onTestFinished,
  }) => {
    // The fixture asserts:
    //   - same worker pid for file-a and file-b (worker reuse)
    //   - DOM body, localStorage, sessionStorage cleared between files
    //   - HTMLElement.prototype mutations from file-a are reverted
    //   - `useFakeTimers()` in file-b doesn't throw "twice on the same
    //     global" after file-a installed them and never uninstalled
    //   - tinyspy-registered spies restored between files
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run'],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: join(__dirname, './fixtures'),
        },
      },
    });

    await expectExecSuccess();
  });
});
