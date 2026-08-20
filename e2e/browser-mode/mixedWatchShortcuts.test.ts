import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
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
    await cli.waitForStdout('[mixed-shortcuts-browser-setup] executed');
    await cli.waitForStdout(/✓ .*node\.test\.ts/);
    await cli.waitForStdout(/✓ .*browser\.test\.ts/);
    await cli.waitForStdout('Waiting for file changes...');

    // Wait until the browser watch session has handed its rerun handles to the
    // node-owned shortcuts (set when the initial browser run resolves).
    await sleep(1000);

    // ========== `p` scopes only node and keeps the browser session intact ==========
    cli.resetStd();
    cli.exec.process!.stdin!.write('p');
    await cli.waitForStdout('Enter file name pattern');
    cli.exec.process!.stdin!.write('node.test.ts\r');
    await cli.waitForStdout(/✓ .*node\.test\.ts/);
    await cli.waitForStdout('Waiting for file changes...');
    expect(cli.stdout).not.toContain('browser.test.ts');
    expect(cli.stdout).not.toContain('[mixed-shortcuts-browser-setup]');

    // ========== `a` reruns node AND browser ==========
    cli.resetStd();
    cli.exec.process!.stdin!.write('a');
    await cli.waitForStdout(/✓ .*node\.test\.ts/);
    await cli.waitForStdout('Re-running 1 affected test file(s)');
    await cli.waitForStdout(/✓ .*browser\.test\.ts/);
    expect(cli.stdout).not.toContain('[mixed-shortcuts-browser-setup]');

    // ========== single `q` closes both sides and exits 0 ==========
    cli.exec.process!.stdin!.write('q');
    await result.expectExecSuccess();
    expect(cli.stdout).toContain('[mixed-shortcuts-browser-teardown] executed');

    await deleteFixtureTarget(fs, fixturesTargetPath);
  }, 90_000);
});
