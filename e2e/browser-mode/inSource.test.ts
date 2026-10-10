import { describe, expect, it } from '@rstest/core';
import { BROWSER_PORTS } from './fixtures/ports';
import { killCliProcessTree, runBrowserCli, runBrowserWatchCli } from './utils';

// `includeSource` files carry their tests in an `if (import.meta.rstest)`
// block. The browser project discovers those source files as test entries and
// defines `import.meta.rstest` in the client build, matching the node
// behavior.
describe.sequential('browser mode - in-source testing', () => {
  it('discovers and runs import.meta.rstest blocks in the browser project and hides them from imported modules', async () => {
    // Verbose reporter prints test-case names, so the assertion proves the
    // in-source case actually executed (not just that the file was listed).
    const { cli, expectExecSuccess } = await runBrowserCli(
      'browser-in-source',
      { args: ['--reporter=verbose'] },
    );

    // Assert per file before the exit code, so a broken fixture fails the
    // expect that names its behavior.
    await cli.exec;
    await cli.waitForStreamsEnd();
    expect(cli.stdout, 'in-source src/sayHi.ts runs as its own entry').toMatch(
      /✓ src\/sayHi\.ts \(1\)/,
    );
    // Imported modules must not see import.meta.rstest, so the importing
    // file's result count stays at its own single test.
    expect(
      cli.stdout,
      'statically imported sayHi must not register its in-source test under tests/static.test.ts',
    ).toMatch(/✓ tests\/static\.test\.ts \(1\)/);
    expect(
      cli.stdout,
      'dynamically imported sayHi must not register its in-source test under tests/dynamic.test.ts',
    ).toMatch(/✓ tests\/dynamic\.test\.ts \(1\)/);
    await expectExecSuccess();

    expect(cli.stdout).toContain('src/sayHi.ts');
    expect(cli.stdout).toContain('runs the in-source test in the browser');
    // Five files: the in-source src/sayHi.ts entry and four regular tests.
    // src/math.ts has no import.meta.rstest block, so it must not become a
    // test entry (node filters those out of includeSource discovery).
    expect(cli.stdout).toMatch(/Test Files.*5 passed/);
    expect(cli.stdout).toMatch(/Tests.*5 passed/);
    expect(
      cli.stdout.match(/runs the in-source test in the browser/g),
    ).toHaveLength(1);
  });

  it('lists an in-source test after a regular test imports it', async () => {
    const { cli, expectExecSuccess } = await runBrowserCli(
      'browser-in-source',
      { command: 'list' },
    );

    await expectExecSuccess();
    expect(cli.stdout).toContain(
      'src/sayHi.ts > runs the in-source test in the browser',
    );
  });

  it('runs in-source tests on the initial watch pass', async () => {
    // Watch mode builds the manifest from `import.meta.webpackContext` globs
    // instead of the one-shot explicit import map, so this exercises the
    // includeSource context + probed-key union in the watch manifest.
    const { cli } = await runBrowserWatchCli('browser-in-source', {
      args: [`--browser.port=${BROWSER_PORTS['browser-in-source-watch']}`],
    });

    try {
      await cli.waitForStdout('Duration');
      expect(cli.stdout).toContain('src/sayHi.ts');
      expect(cli.stdout).toMatch(/Test Files.*5 passed/);
      expect(cli.stdout).toMatch(/Tests.*5 passed/);
    } finally {
      await killCliProcessTree(cli);
    }
  });
});
