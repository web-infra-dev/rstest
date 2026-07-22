import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { prepareFixtures } from '../scripts';
import {
  deleteFixtureTarget,
  killCliProcessTree,
  runBrowserWatchCliWithCwd,
} from './utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('browser mode - watch setup files', () => {
  it('setup file changes should re-run all test files', async () => {
    const fixturesTargetPath = `${__dirname}/fixtures/fixtures-test-browser-watch-setup`;

    const { fs } = await prepareFixtures({
      fixturesPath: `${__dirname}/fixtures/watch-setup`,
      fixturesTargetPath,
    });

    const { cli } = await runBrowserWatchCliWithCwd(fixturesTargetPath);

    // ========== Initial run ==========
    await cli.waitForStdout('Duration');
    expect(cli.stdout).toMatch('Test Files 2 passed');
    await cli.waitForStdout('Waiting for file changes...');

    // ========== Edit the setup file ==========
    cli.resetStd();
    fs.update(path.join(fixturesTargetPath, 'setup.ts'), (content) =>
      content.replace("'one'", "'two'"),
    );

    // A setup change invalidates every test file of the project.
    await cli.waitForStdout(
      '[Watch] Setup file changed, re-running all test files of the project',
    );
    await cli.waitForStdout('Re-running 2 affected test file(s)');
    await cli.waitForStdout('✓ tests/a.test.ts');
    await cli.waitForStdout('✓ tests/b.test.ts');

    await killCliProcessTree(cli);
    await deleteFixtureTarget(fs, fixturesTargetPath);
  }, 60_000);
});
