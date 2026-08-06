import { symlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { prepareFixtures } from '../scripts';
import { BROWSER_PORTS } from './fixtures/ports';
import {
  deleteFixtureTarget,
  killCliProcessTree,
  runBrowserCli,
  runBrowserCliWithCwd,
  runBrowserWatchCli,
} from './utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
    // Four files: the in-source src/sayHi.ts entry and three regular tests.
    // src/math.ts has no import.meta.rstest block, so it must not become a
    // test entry (node filters those out of includeSource discovery).
    expect(cli.stdout).toMatch(/Test Files.*4 passed/);
    expect(cli.stdout).toMatch(/Tests.*4 passed/);
    expect(
      cli.stdout.match(/runs the in-source test in the browser/g),
    ).toHaveLength(1);
  });

  it('does not expose import.meta.rstest to imported modules', async () => {
    for (const testPath of ['tests/static.test.ts', 'tests/dynamic.test.ts']) {
      const { cli, expectExecSuccess } = await runBrowserCli(
        'browser-in-source',
        {
          args: [testPath, '--reporter=verbose'],
        },
      );

      await expectExecSuccess();

      expect(cli.stdout).toMatch(/Test Files.*1 passed/);
      expect(cli.stdout).toMatch(/Tests.*1 passed/);
      expect(cli.stdout).not.toContain(
        'runs the in-source test in the browser',
      );
    }
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
      expect(cli.stdout).toMatch(/Test Files.*4 passed/);
      expect(cli.stdout).toMatch(/Tests.*4 passed/);
    } finally {
      await killCliProcessTree(cli);
    }
  });

  it.skipIf(process.platform === 'win32')(
    'runs an in-source test discovered through a symlink',
    async () => {
      const fixturesTargetPath = join(
        __dirname,
        'fixtures/fixtures-test-browser-in-source-symlink',
      );
      const { fs } = await prepareFixtures({
        fixturesPath: join(__dirname, 'fixtures/browser-in-source'),
        fixturesTargetPath,
      });

      try {
        await symlink(
          '../linked/symlinked.ts',
          join(fixturesTargetPath, 'src/symlinked.ts'),
          'file',
        );
        const { cli, expectExecSuccess } = await runBrowserCliWithCwd(
          fixturesTargetPath,
          { args: ['src/symlinked.ts', '--reporter=verbose'] },
        );

        await expectExecSuccess();
        expect(cli.stdout).toContain(
          'runs a symlinked in-source test in the browser',
        );
        expect(cli.stdout).toMatch(/Test Files.*1 passed/);
        expect(cli.stdout).toMatch(/Tests.*1 passed/);
      } finally {
        await deleteFixtureTarget(fs, fixturesTargetPath);
      }
    },
  );
});
