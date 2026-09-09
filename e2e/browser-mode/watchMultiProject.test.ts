import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { prepareFixtures } from '../scripts';
import {
  deleteFixtureTarget,
  killCliProcessTree,
  runBrowserCliWithCwd,
  runBrowserWatchCliWithCwd,
} from './utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('browser mode - watch with multiple projects', () => {
  it('keeps per-project scope for independent and shared files', async () => {
    const fixturesTargetPath = `${__dirname}/fixtures/fixtures-test-browser-watch-multi-project`;

    const { fs } = await prepareFixtures({
      fixturesPath: `${__dirname}/fixtures/watch-multi-project`,
      fixturesTargetPath,
    });

    const { cli } = await runBrowserWatchCliWithCwd(fixturesTargetPath, {
      env: { DEBUG: '' },
    });

    try {
      // ========== Initial run: project-specific and shared files ==========
      await cli.waitForStdout('Duration');
      expect(cli.stdout).toMatch(/✓ .*a\.test\.ts/);
      expect(cli.stdout).toMatch(/✓ .*b\.test\.ts/);
      await cli.waitForStdout('Waiting for file changes...');

      // ========== Change project-a's source ==========
      cli.resetStd();
      fs.update(
        path.join(fixturesTargetPath, 'project-a/src/helper.ts'),
        (content) => content.replace("return 'alpha'", "return 'alp' + 'ha'"),
      );

      await cli.waitForStdout('Re-running 1 affected test file(s)');
      await cli.waitForStdout('[watch-cycle-files] project-a:a.test.ts');

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
      await cli.waitForStdout('[watch-cycle-files] project-b:b.test.ts');

      if (!cli.stdout.includes('Waiting for file changes...')) {
        await cli.waitForStdout('Waiting for file changes...');
      }
      cli.resetStd();
      // Keep the entry watched by both compilers while changing its test path,
      // which drives the file-set-changed rerun through one shared path scope.
      fs.rename(
        path.join(fixturesTargetPath, 'shared/shared.pending.ts'),
        path.join(fixturesTargetPath, 'shared/shared.test.ts'),
      );

      await cli.waitForStdout('Test file set changed, re-running 4 file(s)');
      await cli.waitForStdout(
        '[watch-cycle-files] project-a:a.test.ts,project-a:shared.test.ts,project-b:b.test.ts,project-b:shared.test.ts',
      );
    } finally {
      await killCliProcessTree(cli);
      await deleteFixtureTarget(fs, fixturesTargetPath);
    }
  }, 60_000);

  // Regression for https://github.com/web-infra-dev/rstest/issues/1484: `rstest
  // list --shard` must not list tests from shard-excluded files, and a project
  // whose shard slice is empty must not start a dev server. Lives here so the
  // `watch-multi-project` fixture is only launched from this test file (see the
  // port-uniqueness rule in fixtures/ports.ts).
  it('lists only the sharded slice and skips shard-empty projects', async () => {
    const { cli, expectExecSuccess } = await runBrowserCliWithCwd(
      path.join(__dirname, 'fixtures', 'watch-multi-project'),
      { command: 'list', args: ['--shard=1/4'] },
    );

    await expectExecSuccess();

    // 4 (project, file) pairs across 2 projects: a 1-of-4 shard holds exactly
    // one pair, so exactly one project has entries and the other must neither
    // be listed nor compiled.
    const entries = cli.stdout
      .split('\n')
      .filter((line) => line.includes(' > '));
    expect(entries).toHaveLength(1);
    expect(cli.stdout.match(/build started/g) ?? []).toHaveLength(1);
  });
});
