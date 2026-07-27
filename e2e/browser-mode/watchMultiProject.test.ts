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

describe('browser mode - watch with multiple projects', () => {
  it('detects changes in both projects (per-project diff baselines)', async () => {
    const fixturesTargetPath = `${__dirname}/fixtures/fixtures-test-browser-watch-multi-project`;

    const { fs } = await prepareFixtures({
      fixturesPath: `${__dirname}/fixtures/watch-multi-project`,
      fixturesTargetPath,
    });

    const { cli } = await runBrowserWatchCliWithCwd(fixturesTargetPath);

    // ========== Initial run: one test file per project ==========
    await cli.waitForStdout('Duration');
    expect(cli.stdout).toMatch('Test Files 2 passed');
    await cli.waitForStdout('Waiting for file changes...');

    // ========== Change project-a's source ==========
    cli.resetStd();
    fs.update(
      path.join(fixturesTargetPath, 'project-a/src/helper.ts'),
      (content) => content.replace("return 'alpha'", "return 'alp' + 'ha'"),
    );

    await cli.waitForStdout('Re-running 1 affected test file(s)');
    expect(cli.stdout).toMatch(/\[Watch\] Affected test files:.*a\.test\.ts/);
    await cli.waitForStdout(/✓ .*a\.test\.ts/);

    // ========== Then change project-b's source ==========
    // Regression guard: project-a's rebuild must not clobber project-b's
    // chunk-hash baseline — the b change must still be detected as exactly one
    // affected file.
    if (!cli.stdout.includes('Waiting for file changes...')) {
      await cli.waitForStdout('Waiting for file changes...');
    }
    cli.resetStd();
    fs.update(
      path.join(fixturesTargetPath, 'project-b/src/helper.ts'),
      (content) => content.replace("return 'bravo'", "return 'bra' + 'vo'"),
    );

    await cli.waitForStdout('Re-running 1 affected test file(s)');
    expect(cli.stdout).toMatch(/\[Watch\] Affected test files:.*b\.test\.ts/);
    expect(cli.stdout).not.toMatch(
      /\[Watch\] Affected test files:.*a\.test\.ts/,
    );
    await cli.waitForStdout(/✓ .*b\.test\.ts/);

    await killCliProcessTree(cli);
    await deleteFixtureTarget(fs, fixturesTargetPath);
  }, 60_000);
});
