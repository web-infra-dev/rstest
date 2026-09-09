import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { prepareFixtures, runRstestCli } from '../scripts/';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('module state sharing under isolate: false', () => {
  it('keeps workers pinned to the resolved environment module', async ({
    onTestFinished,
  }) => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run'],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures', 'environment-module-affinity'),
        },
      },
    });

    await expectExecSuccess();
  });

  it('restores project-scoped globals before reusing a worker', async ({
    onTestFinished,
  }) => {
    const fixturesTargetPath = join(
      __dirname,
      `fixtures-test-project-state-cleanup${
        process.env.RSTEST_OUTPUT_MODULE !== 'false' ? '-module' : ''
      }`,
    );
    await prepareFixtures({
      fixturesPath: join(__dirname, 'fixtures', 'project-state-cleanup'),
      fixturesTargetPath,
    });

    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run'],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: fixturesTargetPath,
        },
      },
    });

    await expectExecSuccess();
    expect(cli.stdout).not.toContain('PROJECT_A_INTERCEPTED_LOG');
    expect(cli.stdout).toContain('PROJECT_B_RAW_LOG');
  });

  // Runs the whole `sharing` fixture dir (one worker, isolate: false) and
  // asserts every file passes. The fixtures never assume a file execution order
  // (the runner does not guarantee one); each guard holds whichever way the
  // files are scheduled. Covers four regressions:
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
  // - https://github.com/web-infra-dev/rstest/issues/767: the test environment
  //   shares the module registry's per-worker lifetime. A persisted module may
  //   capture the DOM at evaluation time (`@testing-library/dom`'s `screen`
  //   binds `document.body` at import); with a per-file environment teardown
  //   those captures dangled on a closed jsdom window, failing every file after
  //   the first on a reused worker — so `shared.ts` captures the DOM alongside
  //   its eval counter, and its a/b.test.ts peers assert both. The flip side is
  //   that a worker must never serve two environment configs: an environment
  //   docblock splits this jsdom project in two, and the pool has to shed its
  //   jsdom worker for the node group (nodeEnvironment.test.ts) while the jsdom
  //   group keeps sharing modules.
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
