import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from '@rstest/core';
import { runRstestCli } from '../scripts/';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('module state sharing under isolate: false', () => {
  // Runs the whole `sharing` fixture dir (one worker, isolate: false) and
  // asserts every file passes. Covers two regressions:
  // - https://github.com/web-infra-dev/rstest/issues/1373: a module imported by
  //   multiple files is evaluated once per worker (state shared) while setup
  //   still re-runs per file (a/b.test.ts + shared.ts).
  // - https://github.com/web-infra-dev/rstest/issues/1376: a context-bound API
  //   captured in a shared module must resolve the current file, not the first
  //   file's torn-down context. The surface guard drives the WHOLE surface
  //   through one persisted helper from a non-first file (surfaceFirst/Second/
  //   Third + surfaceHelper.ts); the subtle `expect` self-delegation is
  //   unit-covered (tests/runtime/api/expect.test.ts).
  it('shares imported module state across files while re-running setup', async ({
    onTestFinished,
  }) => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run'],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures', 'sharing'),
        },
      },
    });

    await expectExecSuccess();
  });
});
