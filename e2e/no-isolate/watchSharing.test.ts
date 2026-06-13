import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, rs } from '@rstest/core';
import { prepareFixtures, runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// File-watch latency makes the rerun timing slightly racy; retry like the other
// watch e2e suites.
rs.setConfig({ retry: 3 });

// EBUSY when rming the temp fixture dir mid-run on Windows (see
// watch/index.test.ts for the same skip).
describe.skipIf(process.platform === 'win32')(
  'module sharing under isolate: false (watch rebuild)',
  () => {
    it('serves the rebuilt shared module value, not the previous build cache', async ({
      onTestFinished,
    }) => {
      const fixturesTargetPath = `${__dirname}/fixtures-test-watch-sharing${
        process.env.RSTEST_OUTPUT_MODULE !== 'false' ? '-module' : ''
      }`;

      const { fs } = await prepareFixtures({
        fixturesPath: `${__dirname}/fixtures/watch-sharing`,
        fixturesTargetPath,
      });

      const { cli } = await runRstestCli({
        command: 'rstest',
        args: ['watch', '--disableConsoleIntercept'],
        onTestFinished,
        options: {
          nodeOptions: {
            cwd: fixturesTargetPath,
          },
        },
      });

      // Initial run evaluates `shared.ts` and caches it in the kept runtime
      // chunk (the optimization that shares module state across files).
      await cli.waitForStdout('SHARED_MARKER=ORIGINAL');
      await cli.waitForStdout('Duration');

      // Edit the shared module: Rsbuild marks basic.test.ts affected and reruns
      // it on the same reused worker.
      cli.resetStd();
      fs.update(path.join(fixturesTargetPath, 'shared.ts'), (content) =>
        content.replace("'ORIGINAL'", "'UPDATED'"),
      );

      // Wait for the rerun to finish (its console.log is flushed before the run
      // summary). The rerun must observe the rebuilt value, not the stale one.
      await cli.waitForStdout('Duration');
      expect(cli.stdout).toMatch('SHARED_MARKER=UPDATED');
      expect(cli.stdout).not.toMatch('SHARED_MARKER=ORIGINAL');
    });
  },
);
