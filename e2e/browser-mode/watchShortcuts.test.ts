import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { prepareFixtures, sleep } from '../scripts';
import {
  deleteFixtureTarget,
  killCliProcessTree,
  runBrowserWatchCliWithCwd,
} from './utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('browser mode - watch CLI shortcuts', () => {
  it('supports q/a/u/f/t/p shortcuts in a browser-only watch session', async () => {
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
    expect(cli.stdout).toMatch('Tests 3 passed');
    await cli.waitForStdout('Waiting for file changes...');
    expect(cli.stdout).not.toContain('press u to update snapshot');

    // The stdin owner installs right after the initial watch run resolves;
    // give it a beat before the first keystroke.
    await sleep(1000);

    // ========== `h` shows the full shortcut menu ==========
    cli.exec.process!.stdin!.write('h');
    await cli.waitForStdout('Shortcuts:');
    expect(cli.stdout).toMatch('rerun failed tests');
    expect(cli.stdout).toMatch('rerun all tests');
    expect(cli.stdout).toMatch('update snapshot');
    expect(cli.stdout).toMatch('filter by a test name regex pattern');
    expect(cli.stdout).toMatch('filter by a filename regex pattern');
    expect(cli.stdout).not.toContain('not yet supported in browser watch');

    // ========== `t` filters tests by name across browser files ==========
    cli.resetStd();
    cli.exec.process!.stdin!.write('t');
    await cli.waitForStdout('Enter test name pattern');
    cli.exec.process!.stdin!.write('alpha\r');
    await cli.waitForStdout('Applied testNamePattern: alpha');
    await cli.waitForStdout('Tests 1 passed | 2 skipped');
    await cli.waitForStdout('Waiting for file changes...');

    // Editing a test file preserves the active `t` filter on rebuild.
    const basicTestPath = path.join(fixturesTargetPath, 'tests/basic.test.ts');
    cli.resetStd();
    writeFileSync(
      basicTestPath,
      `${readFileSync(basicTestPath, 'utf8')}\n// touch\n`,
    );
    await cli.waitForStdout('Re-running 1 affected test file(s)');
    await cli.waitForStdout('Tests 1 passed | 2 skipped');
    await cli.waitForStdout('Waiting for file changes...');
    expect(cli.stdout).toContain('basic.test.ts');
    expect(cli.stdout).not.toContain('snap.test.ts');

    // ========== `p` narrows by filename and composes with active `t` ==========
    cli.resetStd();
    cli.exec.process!.stdin!.write('p');
    await cli.waitForStdout('Enter file name pattern');
    cli.exec.process!.stdin!.write('basic\r');
    await cli.waitForStdout('Applied file filters: basic');
    await cli.waitForStdout('Re-running 1 affected test file(s)');
    await cli.waitForStdout('Tests 1 passed | 2 skipped');
    await cli.waitForStdout('Waiting for file changes...');
    expect(cli.stdout).toContain('basic.test.ts');
    expect(cli.stdout).not.toContain('snap.test.ts');

    // Editing an excluded file (`snap.test.ts`) stays idle under `p basic`.
    // The color change also introduces a screenshot mismatch that `a` reveals.
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
    cli.resetStd();
    writeFileSync(screenshotTestPath, changedTest);
    await cli.waitForStdout(
      'No affected browser test files detected, skipping re-run.',
    );
    await cli.waitForStdout('Waiting for file changes...');
    expect(cli.stdout).not.toContain('Re-running');
    expect(cli.stdout).not.toContain('Test Files');

    // ========== `a` clears BOTH `p` and `t` and reruns every file/test ==========
    cli.resetStd();
    cli.exec.process!.stdin!.write('a');
    await cli.waitForStdout('Re-running 2 affected test file(s)');
    await cli.waitForStdout('Test Files 1 failed | 1 passed');
    await cli.waitForStdout('Tests 1 failed | 2 passed');
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

    // Add a test while its compile is in flight, then request the screenshot
    // update before the watcher has planned the new file set. The new test must
    // still run after the scoped update cycle.
    const addedTestPath = path.join(
      fixturesTargetPath,
      'tests/added-during-update.test.ts',
    );
    writeFileSync(
      addedTestPath,
      `import { expect, test } from '@rstest/core';

test('runs a file added during screenshot update', () => {
  expect('added').toBe('added');
});
`,
    );
    await cli.waitForStdout('File changed, re-running tests...');

    // ========== `u` reruns the unmatched file and creates its PNG reference ==========
    cli.resetStd();
    cli.exec.process!.stdin!.write('u');
    await cli.waitForStdout(
      /(?:Re-running 1 affected test file\(s\)|Test file set changed, re-running 1 file\(s\))/,
    );
    await cli.waitForStdout('✓ tests/snap.test.ts');
    await cli.waitForStdout('✓ tests/added-during-update.test.ts');
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
    await cli.waitForStdout('Re-running 3 affected test file(s)');
    await cli.waitForStdout('✓ tests/snap.test.ts');
    await cli.waitForStdout('✓ tests/basic.test.ts');
    await cli.waitForStdout('✓ tests/added-during-update.test.ts');
    await cli.waitForStdout('Waiting for file changes...');

    // The screenshot failure keeps the process non-zero even though the
    // update and later rerun pass.
    cli.exec.process!.stdin!.write('q');
    await result.expectExecFailed();
    expect(cli.exec.process!.exitCode).toBe(1);

    await deleteFixtureTarget(fs, fixturesTargetPath);
  }, 120_000);

  it('applies t/p/a shortcuts across multi-browser instances and clears startup file filters', async () => {
    const fixturesTargetPath = `${__dirname}/fixtures/fixtures-test-browser-watch-shortcuts-multi`;

    const { fs } = await prepareFixtures({
      fixturesPath: `${__dirname}/fixtures/watch-shortcuts`,
      fixturesTargetPath,
    });

    // Replace screenshot test with a fast DOM test so multi-browser runs stay
    // deterministic across engines without PNG platform baselines.
    fs.update(
      path.join(fixturesTargetPath, 'tests/snap.test.ts'),
      () => `import { expect, it } from '@rstest/core';

it('dom gamma', () => {
  expect(typeof document).toBe('object');
});
`,
    );
    fs.update(path.join(fixturesTargetPath, 'rstest.config.mts'), (content) =>
      content
        .replace(
          "import { BROWSER_PORTS, BROWSER_TEST_TIMEOUT } from '../ports';",
          "import { BROWSER_PORTS, BROWSER_TEST_TIMEOUT, ciChromeEntry } from '../ports';",
        )
        .replace(
          'headless: true,',
          `headless: true,
    instances: [
      { browserName: 'chromium', ...ciChromeEntry() },
      { browserName: 'webkit' },
    ],`,
        ),
    );

    // Start with a CLI file filter (`basic`): only basic.test.ts runs on both browsers.
    const result = await runBrowserWatchCliWithCwd(fixturesTargetPath, {
      args: ['basic'],
    });
    const { cli } = result;
    try {
      await cli.waitForStdout('Test Files 2 passed');
      expect(cli.stdout).toContain('rstest (chromium)');
      expect(cli.stdout).toContain('rstest (webkit)');
      expect(cli.stdout).not.toContain('snap.test.ts');
      await cli.waitForStdout('Waiting for file changes...');
      await sleep(1000);

      // `t` filters by test name across both browser instances within the active file filter.
      cli.resetStd();
      cli.exec.process!.stdin!.write('t');
      await cli.waitForStdout('Enter test name pattern');
      cli.exec.process!.stdin!.write('beta\r');
      await cli.waitForStdout('Applied testNamePattern: beta');
      await cli.waitForStdout('Tests 2 passed | 2 skipped');
      await cli.waitForStdout('Waiting for file changes...');
      expect(cli.stdout).toContain('rstest (chromium)');
      expect(cli.stdout).toContain('rstest (webkit)');
      expect(cli.stdout).not.toContain('snap.test.ts');

      // `a` clears both the startup file filter and `t` pattern across both browsers.
      cli.resetStd();
      cli.exec.process!.stdin!.write('a');
      await cli.waitForStdout('Test Files 4 passed');
      await cli.waitForStdout('Tests 6 passed');
      await cli.waitForStdout('Waiting for file changes...');
      expect(cli.stdout).toContain('basic.test.ts');
      expect(cli.stdout).toContain('snap.test.ts');

      // `p` switches to `snap` across both browsers.
      cli.resetStd();
      cli.exec.process!.stdin!.write('p');
      await cli.waitForStdout('Enter file name pattern');
      cli.exec.process!.stdin!.write('snap\r');
      await cli.waitForStdout('Applied file filters: snap');
      await cli.waitForStdout('Re-running 1 affected test file(s)');
      await cli.waitForStdout('Waiting for file changes...');
      expect(cli.stdout).toContain('snap.test.ts');
      expect(cli.stdout).not.toContain('basic.test.ts');

      cli.exec.process!.stdin!.write('q');
      await result.expectExecSuccess();
    } finally {
      await killCliProcessTree(cli);
      await deleteFixtureTarget(fs, fixturesTargetPath);
    }
  }, 120_000);
});
