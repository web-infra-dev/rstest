import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { prepareFixtures, sleep } from '../scripts';
import { deleteFixtureTarget, runBrowserWatchCliWithCwd } from './utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('browser mode - watch CLI shortcuts', () => {
  it('supports q/a/u shortcuts in a browser-only watch session', async () => {
    const fixturesTargetPath = `${__dirname}/fixtures/fixtures-test-browser-watch-shortcuts`;

    const { fs } = await prepareFixtures({
      fixturesPath: `${__dirname}/fixtures/watch-shortcuts`,
      fixturesTargetPath,
    });

    const result = await runBrowserWatchCliWithCwd(fixturesTargetPath);
    const { cli } = result;

    // ========== Initial run creates the first screenshot reference ==========
    await cli.waitForStdout('Duration');
    expect(cli.stdout).toMatch('Test Files 2 passed');
    await cli.waitForStdout('Waiting for file changes...');
    expect(cli.stdout).not.toContain('press u to update snapshot');

    // The stdin owner installs right after the initial watch run resolves;
    // give it a beat before the first keystroke.
    await sleep(1000);

    // ========== `h` shows the merged shortcut menu ==========
    cli.exec.process!.stdin!.write('h');
    await cli.waitForStdout('Shortcuts:');
    expect(cli.stdout).toMatch('rerun failed tests');
    expect(cli.stdout).toMatch('rerun all tests');
    expect(cli.stdout).toMatch('update snapshot');
    // t/p are not plumbed through the browser rerun pipeline yet.
    expect(cli.stdout).toMatch('not yet supported in browser watch');

    // Change the captured content so the existing PNG reference mismatches.
    const screenshotTestPath = path.join(
      fixturesTargetPath,
      'tests/snap.test.ts',
    );
    const originalTest = readFileSync(screenshotTestPath, 'utf8');
    const changedTest = originalTest.replace(
      'rgb(20, 80, 180)',
      'rgb(180, 40, 20)',
    );
    expect(changedTest).not.toBe(originalTest);
    writeFileSync(screenshotTestPath, changedTest);
    await cli.waitForStdout('File changed, re-running tests...');
    await cli.waitForStdout('Test Files 1 failed | 1 passed');
    await cli.waitForStdout('Waiting for file changes...');
    await cli.waitForStdout('press u to update snapshot');

    // ========== `f` reruns only the failed file ==========
    // The screenshot reference is stale, so the failed set is exactly the
    // screenshot file, and it fails again.
    cli.resetStd();
    cli.exec.process!.stdin!.write('f');
    await cli.waitForStdout('Re-running 1 affected test file(s)');
    await cli.waitForStdout('Test Files 1 failed');
    await cli.waitForStdout('Waiting for file changes...');
    expect(cli.stdout).not.toContain('basic.test.ts');

    // ========== `u` reruns the unmatched file and creates its PNG reference ==========
    cli.resetStd();
    cli.exec.process!.stdin!.write('u');
    await cli.waitForStdout('Re-running 1 affected test file(s)');
    await cli.waitForStdout('✓ tests/snap.test.ts');
    await cli.waitForStdout('Waiting for file changes...');
    const screenshotFiles = readdirSync(
      path.join(fixturesTargetPath, 'tests/__screenshots__'),
      { recursive: true },
    );
    expect(screenshotFiles.some((name) => String(name).endsWith('.png'))).toBe(
      true,
    );

    // ========== `a` reruns every test file ==========
    cli.resetStd();
    cli.exec.process!.stdin!.write('a');
    await cli.waitForStdout('Re-running 2 affected test file(s)');
    await cli.waitForStdout('✓ tests/snap.test.ts');
    await cli.waitForStdout('✓ tests/basic.test.ts');
    await cli.waitForStdout('Waiting for file changes...');

    // The screenshot failure keeps the process non-zero even though the
    // update and later rerun pass.
    cli.exec.process!.stdin!.write('q');
    await result.expectExecFailed();
    expect(cli.exec.process!.exitCode).toBe(1);

    await deleteFixtureTarget(fs, fixturesTargetPath);
  }, 90_000);
});
