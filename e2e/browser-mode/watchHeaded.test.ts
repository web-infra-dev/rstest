import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { prepareFixtures } from '../scripts';
import { BROWSER_PORTS } from './fixtures/ports';
import {
  deleteFixtureTarget,
  killCliProcessTree,
  runBrowserWatchCliWithCwd,
  shouldRunHeadedBrowserTests,
} from './utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('browser mode - headed watch', () => {
  // Headed watch is the only mode that builds the HMR runtime (see
  // `shouldEnableBrowserHmr`); every other fixture in the matrix runs
  // headless or one-shot, so this smoke is the sole coverage between an
  // HMR-runtime-only regression and users' default local `--watch`.
  // Deliberately boot + first run only, no file-change rerun: headed browser
  // sessions are expensive on CI, and the initial run already covers the
  // HMR-runtime bundle shape.
  it.runIf(shouldRunHeadedBrowserTests)(
    'should run tests in headed watch mode',
    async () => {
      const fixturesTargetPath = `${__dirname}/fixtures/fixtures-test-browser-watch-headed`;

      const { fs } = await prepareFixtures({
        fixturesPath: `${__dirname}/fixtures/watch`,
        fixturesTargetPath,
      });

      const { cli } = await runBrowserWatchCliWithCwd(fixturesTargetPath, {
        args: [
          '--browser.headless',
          'false',
          `--browser.port=${BROWSER_PORTS['watch-headed']}`,
        ],
      });

      try {
        await cli.waitForStdout('Duration');
        expect(cli.stdout).toMatch('Test Files 2 passed');
      } finally {
        // A leaked headed browser is costlier than the headless leaks other
        // watch tests tolerate — always tear down, even on assertion failure.
        await killCliProcessTree(cli);
        await deleteFixtureTarget(fs, fixturesTargetPath);
      }
    },
  );
});
