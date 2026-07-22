import { readFileSync } from 'node:fs';
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

    // ========== Initial run: seeded snapshot mismatch ==========
    await cli.waitForStdout('Duration');
    expect(cli.stdout).toMatch('Test Files 1 failed | 1 passed');
    await cli.waitForStdout('Waiting for file changes...');
    // Unmatched snapshot switches the ready hint to the `u` variant.
    await cli.waitForStdout('press u to update snapshot');

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

    // ========== `u` reruns the unmatched file and updates the snapshot ==========
    cli.resetStd();
    cli.exec.process!.stdin!.write('u');
    await cli.waitForStdout('Re-running 1 affected test file(s)');
    await cli.waitForStdout('✓ tests/snap.test.ts');
    await cli.waitForStdout('Waiting for file changes...');
    expect(
      readFileSync(
        path.join(fixturesTargetPath, 'tests/__snapshots__/snap.test.ts.snap'),
        'utf8',
      ),
    ).toContain('"fresh"');

    // ========== `a` reruns every test file ==========
    cli.resetStd();
    cli.exec.process!.stdin!.write('a');
    await cli.waitForStdout('Re-running 2 affected test file(s)');
    await cli.waitForStdout('✓ tests/snap.test.ts');
    await cli.waitForStdout('✓ tests/basic.test.ts');
    await cli.waitForStdout('Waiting for file changes...');

    // ========== `q` tears the session down and exits 0 ==========
    cli.exec.process!.stdin!.write('q');
    await result.expectExecSuccess();

    await deleteFixtureTarget(fs, fixturesTargetPath);
  }, 90_000);
});
