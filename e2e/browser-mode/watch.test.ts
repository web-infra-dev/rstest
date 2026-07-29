import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { prepareFixtures } from '../scripts';
import {
  deleteFixtureTarget,
  killCliProcessTree,
  runBrowserWatchCli,
  runBrowserWatchCliWithCwd,
} from './utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('browser mode - watch', () => {
  it('source file changes should trigger all dependent tests to re-run', async () => {
    const fixturesTargetPath = `${__dirname}/fixtures/fixtures-test-browser-watch-source`;

    const { fs } = await prepareFixtures({
      fixturesPath: `${__dirname}/fixtures/watch`,
      fixturesTargetPath,
    });

    const { cli } = await runBrowserWatchCliWithCwd(fixturesTargetPath);

    // ========== Initial Run ==========
    // Fixture has 2 test files: index.test.ts and another.test.ts
    // Both import from src/helper.ts
    await cli.waitForStdout('Duration');
    expect(cli.stdout).toMatch('Test Files 2 passed');
    if (!cli.stdout.includes('Waiting for file changes...')) {
      await cli.waitForStdout('Waiting for file changes...');
    }

    const helperPath = path.join(fixturesTargetPath, 'src/helper.ts');

    // ========== Update shared source file ==========
    // Both test files depend on helper.ts, so both should re-run
    cli.resetStd();
    fs.update(helperPath, (content) => {
      return content.replace("return 'hello'", "return 'world'");
    });

    // Wait for the re-run message that shows both files were detected
    await cli.waitForStdout('Re-running 2 affected test file(s)');
    // Verify both test files are in the affected list (from debug log)
    expect(cli.stdout).toMatch(
      /\[Watch\] Affected test files:.*another\.test\.ts/,
    );
    expect(cli.stdout).toMatch(
      /\[Watch\] Affected test files:.*index\.test\.ts/,
    );
    // Wait for test execution result (proves the rerun actually executed)
    await cli.waitForStdout("expected 'world' to be 'hello'");
    if (!cli.stdout.includes('Waiting for file changes...')) {
      await cli.waitForStdout('Waiting for file changes...');
    }

    // ========== Fix source file ==========
    cli.resetStd();
    fs.update(helperPath, (content) => {
      return content.replace("return 'world'", "return 'hello'");
    });

    // Wait for the re-run and verify both files are affected again
    await cli.waitForStdout('Re-running 2 affected test file(s)');
    expect(cli.stdout).toMatch(
      /\[Watch\] Affected test files:.*another\.test\.ts/,
    );
    expect(cli.stdout).toMatch(
      /\[Watch\] Affected test files:.*index\.test\.ts/,
    );
    // At least one test should pass
    await cli.waitForStdout('✓ tests/');

    await killCliProcessTree(cli);
    await deleteFixtureTarget(fs, fixturesTargetPath);
  });

  it('test files should be ran when create / update / rename / delete', async () => {
    const fixturesTargetPath = `${__dirname}/fixtures/fixtures-test-browser-watch`;

    const { fs } = await prepareFixtures({
      fixturesPath: `${__dirname}/fixtures/watch`,
      fixturesTargetPath,
    });

    const { cli } = await runBrowserWatchCliWithCwd(fixturesTargetPath);

    // ========== Initial Run ==========
    // Initial run outputs full summary with Duration
    await cli.waitForStdout('Duration');
    expect(cli.stdout).toMatch('Test Files 2 passed');
    if (!cli.stdout.includes('Waiting for file changes...')) {
      await cli.waitForStdout('Waiting for file changes...');
    }

    const newTestPath = path.join(fixturesTargetPath, 'tests/new.test.ts');
    const renamedTestPath = path.join(
      fixturesTargetPath,
      'tests/renamed.test.ts',
    );
    const waitForRerunSignal = async () => {
      const marker = 'File changed, re-running tests...';
      if (!cli.stdout.includes(marker)) {
        await cli.waitForStdout(marker);
      }
      expect(cli.stdout).toContain(marker);
    };
    const waitForOutput = async (marker: string | RegExp) => {
      if (typeof marker === 'string') {
        if (cli.stdout.includes(marker)) {
          return;
        }
      } else if (cli.stdout.match(marker)) {
        return;
      }
      await cli.waitForStdout(marker);
    };

    const waitForRerunResult = async (marker: string | RegExp) => {
      const state = await Promise.race([
        waitForOutput(marker).then(() => 'expected' as const),
        waitForOutput('Build error:').then(() => 'build-error' as const),
        waitForOutput('error   build failed').then(
          () => 'build-failed' as const,
        ),
      ]);

      if (state !== 'expected') {
        throw new Error(
          `Unexpected build error during browser watch cycle:\n${cli.stdout}`,
        );
      }
    };
    // ========== Create: Add new test file ==========
    cli.resetStd();
    fs.create(
      newTestPath,
      `import { describe, expect, it } from '@rstest/core';
    describe('new test', () => {
  it('should pass', () => {
    expect('new').toBe('new');
  });
});`,
    );
    await waitForRerunSignal();
    await waitForRerunResult('✓ tests/new.test.ts');
    expect(cli.stdout).toContain('✓ tests/new.test.ts');

    // ========== Update (break): Modify new test file to fail ==========
    cli.resetStd();
    fs.update(newTestPath, (content) => {
      return content.replace("toBe('new')", "toBe('modified')");
    });
    await waitForRerunSignal();
    await waitForRerunResult("expected 'new' to be 'modified'");
    expect(cli.stdout).toContain("expected 'new' to be 'modified'");

    // ========== Update (fix): Fix the test file ==========
    cli.resetStd();
    fs.update(newTestPath, (content) => {
      return content.replace("toBe('modified')", "toBe('new')");
    });
    await waitForRerunSignal();
    await waitForRerunResult('✓ tests/new.test.ts');
    expect(cli.stdout).toContain('✓ tests/new.test.ts');

    // ========== Rename: Rename new.test.ts to renamed.test.ts ==========
    cli.resetStd();
    fs.rename(newTestPath, renamedTestPath);
    await waitForRerunSignal();
    await waitForRerunResult('✓ tests/renamed.test.ts');
    expect(cli.stdout).toContain('✓ tests/renamed.test.ts');

    // ========== Delete: Remove the renamed test file ==========
    cli.resetStd();
    fs.delete(renamedTestPath);
    await waitForRerunSignal();
    await waitForRerunResult('✓ tests/index.test.ts');
    expect(cli.stdout).toContain('✓ tests/index.test.ts');

    await killCliProcessTree(cli);
    await deleteFixtureTarget(fs, fixturesTargetPath);
  }, 30_000);

  // The bundler keeps no file watcher attached while its dev-compile hook is
  // pending, so a rerun trigger signalled from that hook must hand the cycle to
  // core and return. Holding the hook for the whole cycle makes every file
  // created or deleted during a run invisible for good: no rebuild, no rerun,
  // no matter how long the session then idles.
  it('should pick up a test file deleted while a cycle is still running', async () => {
    const fixturesTargetPath = `${__dirname}/fixtures/fixtures-test-browser-watch-in-flight`;

    const { fs } = await prepareFixtures({
      fixturesPath: `${__dirname}/fixtures/watch`,
      fixturesTargetPath,
    });

    // Two files: one that keeps a cycle busy long enough to delete the other
    // in the middle of it, and both importing the source that triggers it.
    fs.delete(path.join(fixturesTargetPath, 'tests/another.test.ts'));
    fs.create(
      path.join(fixturesTargetPath, 'tests/slow.test.ts'),
      `import { describe, expect, it } from '@rstest/core';
import { getMessage } from '../src/helper';

describe('slow test', () => {
  it('should keep the cycle busy', async () => {
    await new Promise((resolve) => setTimeout(resolve, 4000));
    expect(typeof getMessage()).toBe('string');
  });
});`,
    );

    const { cli } = await runBrowserWatchCliWithCwd(fixturesTargetPath);

    await cli.waitForStdout('Duration');
    expect(cli.stdout).toMatch('Test Files 2 passed');

    // Touch the shared source so both files re-run, then delete one of them
    // while that cycle is still executing the slow test.
    cli.resetStd();
    fs.update(path.join(fixturesTargetPath, 'src/helper.ts'), (content) =>
      content.replace("return 'hello'", "return 'world'"),
    );
    await cli.waitForStdout('Re-running 2 affected test file(s)');
    fs.delete(path.join(fixturesTargetPath, 'tests/index.test.ts'));

    await cli.waitForStdout('Test file set changed, re-running 1 file(s)');
    await cli.waitForStdout('✓ tests/slow.test.ts');

    await killCliProcessTree(cli);
    await deleteFixtureTarget(fs, fixturesTargetPath);
  }, 90_000);

  it('should not emit HMR fallback warning when setup files are eager compiled', async () => {
    const { cli } = await runBrowserWatchCli('browser-react');

    await cli.waitForStdout('Duration');
    expect(cli.stdout).toContain('setupImport.test.tsx');
    expect(cli.stdout).not.toContain(
      'HMR update failed, performing full reload',
    );
    expect(cli.stdout).not.toContain('is not accepted');

    await killCliProcessTree(cli);
  }, 30_000);
});
