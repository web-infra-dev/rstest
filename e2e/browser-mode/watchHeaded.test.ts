import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { prepareFixtures } from '../scripts';
import { BROWSER_PORTS } from './fixtures/ports';
import {
  deleteFixtureTarget,
  killCliProcessTree,
  runBrowserWatchCliWithCwd,
  runBrowserWatchCrud,
  shouldRunHeadedBrowserTests,
} from './utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('browser mode - headed watch', () => {
  // Headed watch is the only mode that builds the HMR runtime (see
  // `shouldEnableBrowserHmr`); every other fixture in the matrix runs
  // headless or one-shot, so this smoke is the sole coverage between an
  // HMR-runtime-only regression and users' default local `--watch`.
  it.runIf(shouldRunHeadedBrowserTests)(
    'should run tests and track file-set changes in headed watch mode',
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
        await cli.waitForStdout('Waiting for file changes...');

        await runBrowserWatchCrud({
          cli,
          fixtureFs: fs,
          fixtureRoot: fixturesTargetPath,
        });
      } finally {
        // A leaked headed browser is costlier than the headless leaks other
        // watch tests tolerate — always tear down, even on assertion failure.
        await killCliProcessTree(cli);
        await deleteFixtureTarget(fs, fixturesTargetPath);
      }
    },
    60_000,
  );

  it.runIf(shouldRunHeadedBrowserTests)(
    'should keep the watch session live when a pending reload file is deleted mid-flight',
    async () => {
      const fixturesTargetPath = `${__dirname}/fixtures/fixtures-test-browser-watch-headed-pending-delete`;
      const anotherTestPath = path.join(
        fixturesTargetPath,
        'tests/another.test.ts',
      );

      const { fs } = await prepareFixtures({
        fixturesPath: `${__dirname}/fixtures/watch`,
        fixturesTargetPath,
      });
      // Stall every runner boot so a reload stays in flight long enough for the
      // delete below to land while it is pending — the state
      // `reconcilePendingHeadedReloads` exists to settle.
      fs.update(path.join(fixturesTargetPath, 'setup.ts'), (content) => {
        return `const slowBootEnd = Date.now() + 1_500;\nwhile (Date.now() < slowBootEnd) {}\n${content}`;
      });

      const { cli } = await runBrowserWatchCliWithCwd(fixturesTargetPath, {
        args: [
          '--browser.headless',
          'false',
          `--browser.port=${BROWSER_PORTS['watch-headed']}`,
        ],
      });

      try {
        await cli.waitForStdout('Test Files 2 passed');
        await cli.waitForStdout('Waiting for file changes...');

        cli.resetStd();
        fs.update(anotherTestPath, (content) => `${content}\n// touch\n`);
        // Wait for the navigation itself rather than sleeping: if the delete
        // beat the reload, the race would never happen and the test would pass
        // without exercising anything.
        await cli.waitForStdout('[Container] Setting iframe.src to:');
        fs.delete(anotherTestPath);

        await cli.waitForStdout('Test file set changed, re-running 1 file(s)');
        await cli.waitForStdout('✓ tests/index.test.ts');
        await cli.waitForStdout('Test Files 1 passed');
      } finally {
        await killCliProcessTree(cli);
        await deleteFixtureTarget(fs, fixturesTargetPath);
      }
    },
    60_000,
  );

  it.runIf(shouldRunHeadedBrowserTests)(
    'should keep the watch session live after an initial fatal error',
    async () => {
      const fixturesTargetPath = `${__dirname}/fixtures/fixtures-test-browser-watch-headed-initial-fatal`;
      const setupPath = path.join(fixturesTargetPath, 'setup.ts');
      const initialFatal = "throw new Error('initial headed setup failed');\n";

      const { fs } = await prepareFixtures({
        fixturesPath: `${__dirname}/fixtures/watch`,
        fixturesTargetPath,
      });
      fs.delete(path.join(fixturesTargetPath, 'tests/another.test.ts'));
      fs.update(setupPath, (content) => initialFatal + content);

      const { cli } = await runBrowserWatchCliWithCwd(fixturesTargetPath, {
        args: [
          '--browser.headless',
          'false',
          `--browser.port=${BROWSER_PORTS['watch-headed']}`,
        ],
      });
      const waitForOutput = (marker: string) =>
        Promise.race([cli.waitForStdout(marker), cli.waitForStderr(marker)]);

      try {
        await waitForOutput('initial headed setup failed');
        await waitForOutput('Waiting for file changes...');

        fs.update(setupPath, (content) => content.replace(initialFatal, ''));
        await cli.waitForStdout(
          '[Watch] Setup file changed, re-running all test files of the project',
        );
        await cli.waitForStdout('Re-running 1 affected test file(s)');
        await cli.waitForStdout('Test Files 1 passed');
      } finally {
        await killCliProcessTree(cli);
        await deleteFixtureTarget(fs, fixturesTargetPath);
      }
    },
    60_000,
  );
});
