import { describe, expect, it } from '@rstest/core';
import { BROWSER_PORTS } from './fixtures/ports';
import { killCliProcessTree, runBrowserCli, runBrowserWatchCli } from './utils';

// `includeSource` files carry their tests in an `if (import.meta.rstest)`
// block. The browser project discovers those source files as test entries and
// defines `import.meta.rstest` in the client build, matching the node
// behavior.
describe('browser mode - in-source testing', () => {
  it('discovers and runs import.meta.rstest blocks in the browser project', async () => {
    // Verbose reporter prints test-case names, so the assertion proves the
    // in-source case actually executed (not just that the file was listed).
    const { cli, expectExecSuccess } = await runBrowserCli(
      'browser-in-source',
      { args: ['--reporter=verbose'] },
    );

    await expectExecSuccess();

    expect(cli.stdout).toContain('src/sayHi.ts');
    expect(cli.stdout).toContain('runs the in-source test in the browser');
    // Two files: the in-source src/sayHi.ts entry and tests/math.test.ts.
    // src/math.ts has no import.meta.rstest block, so it must not become a
    // test entry (node filters those out of includeSource discovery).
    expect(cli.stdout).toMatch(/Test Files.*2 passed/);
    expect(cli.stdout).toMatch(/Tests.*2 passed/);
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
      expect(cli.stdout).toMatch(/Test Files.*2 passed/);
      expect(cli.stdout).toMatch(/Tests.*2 passed/);
    } finally {
      await killCliProcessTree(cli);
    }
  });
});
