import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from '@rstest/core';
import { runRstestCli } from '../scripts/';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('module mocks under isolate: false', () => {
  // Runs the `mock-stale-cache` fixture (one worker, isolate: false). Its
  // files never assume an execution order, so both regressions stay covered
  // whichever way the runner schedules them: a mock must take effect through
  // a consumer cached by an earlier file (module-mock pre-flush, see
  // runInPool.ts), and must not leak into later files (between-files cleaner,
  // see mockRuntimeCode.js). Details live in the fixture files' own comments.
  // See https://github.com/web-infra-dev/rstest/issues/1556.
  it('applies and undoes module mocks across the file boundary', async ({
    onTestFinished,
  }) => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run'],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures', 'mock-stale-cache'),
        },
      },
    });

    await expectExecSuccess();
  });
});
