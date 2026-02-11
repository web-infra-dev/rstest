import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import treeKill from 'tree-kill';
import { prepareFixtures, runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('browser mode - watch', () => {
  it('source file changes should trigger all dependent tests to re-run', async () => {
    const fixturesTargetPath = `${__dirname}/fixtures/fixtures-test-browser-watch-source`;

    const { fs } = await prepareFixtures({
      fixturesPath: `${__dirname}/fixtures/watch`,
      fixturesTargetPath,
    });

    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['watch', '--disableConsoleIntercept'],
      options: {
        nodeOptions: {
          env: { DEBUG: 'rstest' },
          cwd: fixturesTargetPath,
        },
      },
    });

    // ========== Initial Run ==========
    // Fixture has 2 test files: index.test.ts and another.test.ts
    // Both import from src/helper.ts
    await cli.waitForStdout('Duration');
    expect(cli.stdout).toMatch('Test Files 2 passed');

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

    // Kill the process tree
    const pid = cli.exec.process?.pid;
    if (pid) {
      treeKill(pid, 'SIGKILL');
    } else {
      cli.exec.kill();
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));

    try {
      fs.delete(fixturesTargetPath);
    } catch (err) {
      if (process.platform !== 'win32') {
        throw err;
      }
    }
  });

  it('test files should be ran when create / update / rename / delete', async () => {
    const fixturesTargetPath = `${__dirname}/fixtures/fixtures-test-browser-watch`;

    const { fs } = await prepareFixtures({
      fixturesPath: `${__dirname}/fixtures/watch`,
      fixturesTargetPath,
    });

    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['watch', '--disableConsoleIntercept'],
      options: {
        nodeOptions: {
          env: { DEBUG: 'rstest' },
          cwd: fixturesTargetPath,
        },
      },
    });

    // ========== Initial Run ==========
    // Initial run outputs full summary with Duration
    await cli.waitForStdout('Duration');
    expect(cli.stdout).toMatch('Test Files 2 passed');
    if (
      !cli.stdout.includes(
        'Watch mode enabled - will re-run tests on file changes',
      )
    ) {
      await cli.waitForStdout(
        'Watch mode enabled - will re-run tests on file changes',
      );
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
    const settleWatchCycle = async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
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
    await settleWatchCycle();

    // ========== Update (break): Modify new test file to fail ==========
    cli.resetStd();
    fs.update(newTestPath, (content) => {
      return content.replace("toBe('new')", "toBe('modified')");
    });
    await waitForRerunSignal();
    await waitForRerunResult("expected 'new' to be 'modified'");
    expect(cli.stdout).toContain("expected 'new' to be 'modified'");
    await settleWatchCycle();

    // ========== Update (fix): Fix the test file ==========
    cli.resetStd();
    fs.update(newTestPath, (content) => {
      return content.replace("toBe('modified')", "toBe('new')");
    });
    await waitForRerunSignal();
    await waitForRerunResult('✓ tests/new.test.ts');
    expect(cli.stdout).toContain('✓ tests/new.test.ts');
    await settleWatchCycle();

    // ========== Rename: Rename new.test.ts to renamed.test.ts ==========
    cli.resetStd();
    fs.rename(newTestPath, renamedTestPath);
    await waitForRerunSignal();
    await waitForRerunResult('✓ tests/renamed.test.ts');
    expect(cli.stdout).toContain('✓ tests/renamed.test.ts');
    await settleWatchCycle();

    // ========== Delete: Remove the renamed test file ==========
    cli.resetStd();
    fs.delete(renamedTestPath);
    await waitForRerunSignal();
    await waitForRerunResult('✓ tests/index.test.ts');
    expect(cli.stdout).toContain('✓ tests/index.test.ts');

    // Kill the entire process tree to ensure browser and all child processes are terminated.
    // This is critical on Windows where child processes are not killed by default.
    const pid = cli.exec.process?.pid;
    if (pid) {
      treeKill(pid, 'SIGKILL');
    } else {
      cli.exec.kill();
    }

    // Wait for process and browser to fully exit and release file handles (especially on Windows)
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Clean up fixtures folder
    // Note: On Windows, file handles may not be fully released even after waiting,
    // causing EBUSY errors. This is a known issue with watch mode tests.
    // See: https://github.com/nodejs/node/issues/49985
    try {
      fs.delete(fixturesTargetPath);
    } catch (err) {
      if (process.platform !== 'win32') {
        throw err;
      }
    }
  }, 30_000);
});
