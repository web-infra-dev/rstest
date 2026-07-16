import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from '@rstest/core';
import { prepareFixtures, sleep } from '../scripts';
import { deleteFixtureTarget, runBrowserWatchCliWithCwd } from './utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('browser mode - mixed watch CLI shortcuts', () => {
  it('node-owned stdin fans a/q out to the browser session', async () => {
    const fixturesTargetPath = `${__dirname}/fixtures/fixtures-test-mixed-watch-shortcuts`;

    const { fs } = await prepareFixtures({
      fixturesPath: `${__dirname}/fixtures/mixed-watch-shortcuts`,
      fixturesTargetPath,
    });

    const result = await runBrowserWatchCliWithCwd(fixturesTargetPath);
    const { cli } = result;

    // ========== Initial run: both sides complete ==========
    await cli.waitForStdout(/✓ .*node\.test\.ts/);
    await cli.waitForStdout(/✓ .*browser\.test\.ts/);
    await cli.waitForStdout('Waiting for file changes...');

    // Wait until the browser watch session has handed its rerun handles to the
    // node-owned shortcuts (set when the initial browser run resolves).
    await sleep(1000);

    // ========== `a` reruns node AND browser ==========
    cli.resetStd();
    cli.exec.process!.stdin!.write('a');
    await cli.waitForStdout(/✓ .*node\.test\.ts/);
    await cli.waitForStdout('Re-running 1 affected test file(s)');
    await cli.waitForStdout(/✓ .*browser\.test\.ts/);

    // ========== single `q` closes both sides and exits 0 ==========
    cli.exec.process!.stdin!.write('q');
    await result.expectExecSuccess();

    await deleteFixtureTarget(fs, fixturesTargetPath);
  }, 90_000);
});
