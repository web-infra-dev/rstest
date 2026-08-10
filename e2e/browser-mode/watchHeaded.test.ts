import nodeFs from 'node:fs';
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

type JsonFileCoverage = {
  s: Record<string, number>;
};

const readHelperCoverage = (
  reportPath: string,
): JsonFileCoverage | undefined => {
  const report = JSON.parse(nodeFs.readFileSync(reportPath, 'utf8')) as Record<
    string,
    JsonFileCoverage
  >;
  return Object.entries(report).find(([file]) =>
    file.replaceAll('\\', '/').endsWith('/src/helper.ts'),
  )?.[1];
};

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

  it.runIf(shouldRunHeadedBrowserTests)(
    'should report partial V8 coverage after a fatal watch rerun',
    async () => {
      const fixturesTargetPath = `${__dirname}/fixtures/fixtures-test-browser-watch-headed-fatal-coverage`;
      const testPath = path.join(fixturesTargetPath, 'tests/index.test.ts');
      const reportsDirectory = path.join(
        fixturesTargetPath,
        'coverage-v8-watch',
      );
      const reportPath = path.join(reportsDirectory, 'coverage-final.json');

      const { fs } = await prepareFixtures({
        fixturesPath: `${__dirname}/fixtures/watch`,
        fixturesTargetPath,
      });
      fs.delete(path.join(fixturesTargetPath, 'tests/another.test.ts'));

      const { cli } = await runBrowserWatchCliWithCwd(fixturesTargetPath, {
        args: [
          '-c',
          'rstest.v8.config.mts',
          '--browser.headless',
          'false',
          `--browser.port=${BROWSER_PORTS['watch-headed']}`,
        ],
      });
      const waitForOutput = (marker: string) =>
        Promise.race([cli.waitForStdout(marker), cli.waitForStderr(marker)]);

      try {
        await waitForOutput('Waiting for file changes...');
        nodeFs.rmSync(reportsDirectory, { recursive: true, force: true });
        cli.resetStd();

        fs.update(testPath, (content) =>
          content.replace(
            "describe('watch mode test'",
            `getMessage();
throw new Error('headed watch coverage fatal');

describe('watch mode test'`,
          ),
        );

        await waitForOutput('headed watch coverage fatal');
        await waitForOutput('Waiting for file changes...');

        expect(nodeFs.existsSync(reportPath)).toBe(true);
        const helperCoverage = readHelperCoverage(reportPath);
        expect(helperCoverage).toBeDefined();
        expect(Object.values(helperCoverage?.s ?? {})).toContain(1);
      } finally {
        await killCliProcessTree(cli);
        await deleteFixtureTarget(fs, fixturesTargetPath);
      }
    },
    60_000,
  );
});
