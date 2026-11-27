import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { prepareFixtures, sleep } from '../scripts';
import { deleteFixtureTarget, runBrowserWatchCliWithCwd } from './utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('browser mode - mixed watch CLI shortcuts', () => {
  it('node-owned stdin fans p/t/a/q out across node and browser sessions', async () => {
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

    // ========== `p` matching only node keeps browser idle ==========
    cli.resetStd();
    cli.exec.process!.stdin!.write('p');
    await cli.waitForStdout('Enter file name pattern');
    cli.exec.process!.stdin!.write('node.test.ts\r');
    await cli.waitForStdout(/✓ .*node\.test\.ts/);
    await cli.waitForStdout('Waiting for file changes...');
    expect(cli.stdout).not.toContain('browser.test.ts');
    expect(cli.stdout).not.toContain('[mixed-shortcuts-browser-setup]');

    // ========== `p` matching only browser runs browser and keeps node idle ==========
    cli.resetStd();
    cli.exec.process!.stdin!.write('p');
    await cli.waitForStdout('Enter file name pattern');
    cli.exec.process!.stdin!.write('browser.test.ts\r');
    await cli.waitForStdout('Re-running 1 affected test file(s)');
    await cli.waitForStdout(/✓ .*browser\.test\.ts/);
    await cli.waitForStdout('Waiting for file changes...');
    expect(cli.stdout).not.toContain('node.test.ts');
    expect(cli.stdout).not.toContain('[mixed-shortcuts-browser-setup]');

    // ========== `t` while `p browser.test.ts` is active filters browser tests only ==========
    cli.resetStd();
    cli.exec.process!.stdin!.write('t');
    await cli.waitForStdout('Enter test name pattern');
    cli.exec.process!.stdin!.write('alpha\r');
    await cli.waitForStdout('Applied testNamePattern: alpha');
    await cli.waitForStdout(/✓ .*browser\.test\.ts/);
    // Node still holds 2 passed from its prior cycle; browser ran 1 passed | 1 skipped.
    await cli.waitForStdout('Tests 3 passed | 1 skipped');
    await cli.waitForStdout('Waiting for file changes...');
    expect(cli.stdout).not.toContain('node.test.ts');

    // ========== `p` empty clears file filter and runs both sides under `t alpha` ==========
    cli.resetStd();
    cli.exec.process!.stdin!.write('p');
    await cli.waitForStdout('Enter file name pattern');
    cli.exec.process!.stdin!.write('\r');
    await cli.waitForStdout('Cleared file filters');
    await cli.waitForStdout(/✓ .*node\.test\.ts/);
    await cli.waitForStdout('Re-running 1 affected test file(s)');
    await cli.waitForStdout(/✓ .*browser\.test\.ts/);
    await cli.waitForStdout('Tests 2 passed | 2 skipped');
    await cli.waitForStdout('Waiting for file changes...');

    // ========== `a` clears both `t` and `p` and reruns all tests on both sides ==========
    cli.resetStd();
    cli.exec.process!.stdin!.write('a');
    await cli.waitForStdout(/✓ .*node\.test\.ts/);
    await cli.waitForStdout('Re-running 1 affected test file(s)');
    await cli.waitForStdout(/✓ .*browser\.test\.ts/);
    await cli.waitForStdout('Tests 4 passed');
    await cli.waitForStdout('Waiting for file changes...');
    expect(cli.stdout).not.toContain('[mixed-shortcuts-browser-setup]');

    // ========== single `q` closes both sides and exits 0 ==========
    cli.exec.process!.stdin!.write('q');
    await result.expectExecSuccess();
    expect(cli.stdout).toContain('[mixed-shortcuts-browser-teardown] executed');

    await deleteFixtureTarget(fs, fixturesTargetPath);
  }, 120_000);
});
