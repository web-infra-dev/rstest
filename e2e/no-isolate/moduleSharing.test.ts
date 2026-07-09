import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from '@rstest/core';
import { runRstestCli } from '../scripts/';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('module state sharing under isolate: false', () => {
  // Runs the whole `sharing` fixture dir (one worker, isolate: false) and
  // asserts every file passes. The fixtures never assume a file execution order
  // (the runner does not guarantee one); each guard holds whichever way the
  // files are scheduled. Covers three regressions:
  // - https://github.com/web-infra-dev/rstest/issues/1373: a module imported by
  //   multiple files is evaluated once per worker (state shared) while setup
  //   still re-runs per file (a/b.test.ts + shared.ts).
  // - https://github.com/web-infra-dev/rstest/issues/1376: a context-bound API
  //   captured in a shared module must resolve the current file, not the
  //   evaluating file's torn-down context. Three peer files drive the WHOLE
  //   surface through one persisted helper (surfaceA/B/C + surfaceHelper.ts);
  //   whichever runs second exercises the late-bind path, and its shared
  //   afterAll (a non-first file's) is observed by whichever runs third. The
  //   subtle `expect` self-delegation is unit-covered
  //   (tests/runtime/api/expect.test.ts).
  // - https://github.com/web-infra-dev/rstest/pull/1376#discussion_r3457255132: a
  //   mock defined in a module shared across files persists, so `clearMocks`
  //   must keep resetting it across the file boundary even though the per-file
  //   reset no longer clears the (weakly-held) registry (mockShareA/mockShareB +
  //   sharedMock.ts).
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
