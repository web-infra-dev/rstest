import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { prepareFixtures, sleep } from '../scripts';
import {
  deleteFixtureTarget,
  killCliProcessTree,
  runBrowserCli,
  runBrowserWatchCli,
  runBrowserWatchCliWithCwd,
} from './utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Phase 5 step 5 gate (red-first): browser projects must run `globalSetup` on
// the host — today the browser path never compiles nor executes it — and the
// post-setup `process.env` change-set must be propagated into the browser
// runtime env store (readable via `process.env` / `import.meta.env`), with
// explicit `test.env` config still winning over globalSetup mutations.
describe('browser mode - globalSetup', () => {
  it('runs globalSetup, propagates env into browser tests, and tears down in order', async () => {
    const { cli, expectExecSuccess } = await runBrowserCli(
      'browser-global-setup',
    );

    await expectExecSuccess();

    const setupIndex = cli.stdout.indexOf('[browser-global-setup] executed');
    const testIndex = cli.stdout.indexOf('[browser-global-setup-test] running');
    const teardownIndex = cli.stdout.indexOf(
      '[browser-global-teardown] executed',
    );

    // Setup runs before any browser test output, teardown after all of it.
    expect(setupIndex).toBeGreaterThanOrEqual(0);
    expect(testIndex).toBeGreaterThan(setupIndex);
    expect(teardownIndex).toBeGreaterThan(testIndex);
  });

  it('skips globalSetup when the shard slice has no files for the project', async () => {
    // The fixture has a single test file: shard 2/2 is deterministically
    // empty, so the stage must not run setup (or queue teardown) for it —
    // and the browser cycle must honor the same shard and run no tests.
    const { cli } = await runBrowserCli('browser-global-setup', {
      args: ['--shard=2/2'],
    });

    await cli.exec;

    expect(cli.stdout).not.toContain('[browser-global-setup] executed');
    expect(cli.stdout).not.toContain('[browser-global-teardown] executed');
    expect(cli.stdout).not.toContain('[browser-global-setup-test] running');
  });

  it('fails the run before tests when globalSetup throws', async () => {
    const { cli, expectExecFailed, expectStderrLog } = await runBrowserCli(
      'browser-global-setup-error',
    );

    await expectExecFailed();

    expectStderrLog(/Global setup failed intentionally/);
    expect(cli.log).not.toContain('This should not be printed');
  });

  it('runs each project globalSetup in a mixed node + browser run', async () => {
    const { cli, expectExecSuccess } = await runBrowserCli(
      'browser-global-setup-mixed',
    );

    await expectExecSuccess();

    expect(cli.stdout).toContain('[mixed-node-global-setup] executed');
    expect(cli.stdout).toContain('[mixed-browser-global-setup] executed');
    expect(cli.stdout).toContain('[mixed-node-global-teardown] executed');
    expect(cli.stdout).toContain('[mixed-browser-global-teardown] executed');
    expect(cli.stdout).toMatch(/Tests.*2 passed/);
  });

  it('drains global teardown on the mixed path when a file filter selects only the browser project', async () => {
    // With no node tests to run, the node executor is never constructed, so the
    // teardown drain must live in core — otherwise the setup's IPC child leaks
    // and the process hangs (the awaited exec would time out here).
    const { cli, expectExecSuccess } = await runBrowserCli(
      'browser-global-setup-mixed',
      { args: ['project-browser/tests/browserOnly.test.ts'] },
    );

    await expectExecSuccess();

    expect(cli.stdout).toContain('[mixed-browser-global-setup] executed');
    expect(cli.stdout).toContain('[mixed-browser-global-teardown] executed');
    // The node project matches no running tests, so its globalSetup must not run.
    expect(cli.stdout).not.toContain('[mixed-node-global-setup] executed');
  });

  it('runs globalSetup once during a browser-only watch session', async () => {
    const result = await runBrowserWatchCli('browser-global-setup');
    const { cli } = result;

    try {
      await cli.waitForStdout('Duration');
      await cli.waitForStdout('Waiting for file changes...');

      const setupIndex = cli.stdout.indexOf('[browser-global-setup] executed');
      const testIndex = cli.stdout.indexOf('Test Files 1 passed');

      expect(setupIndex).toBeGreaterThanOrEqual(0);
      expect(testIndex).toBeGreaterThan(setupIndex);
      expect(cli.stdout).toMatch(/Test Files.*1 passed/);
      expect(cli.stdout).toMatch(/Tests.*3 passed/);

      await sleep(1000);
      cli.resetStd();
      cli.exec.process!.stdin!.write('a');

      await cli.waitForStdout('Re-running 1 affected test file(s)');
      await cli.waitForStdout('Test Files 1 passed');
      await cli.waitForStdout('Waiting for file changes...');
      expect(cli.stdout).not.toContain('[browser-global-setup] executed');

      cli.exec.process!.stdin!.write('q');
      await result.expectExecSuccess();
      expect(cli.stdout).toContain('[browser-global-teardown] executed');
    } finally {
      await killCliProcessTree(cli);
    }
  }, 60_000);

  it('reruns globalSetup after a browser-only config restart', async () => {
    const fixturesTargetPath = path.join(
      __dirname,
      'fixtures/fixtures-test-browser-global-setup-restart',
    );
    const { fs } = await prepareFixtures({
      fixturesPath: path.join(__dirname, 'fixtures/browser-global-setup'),
      fixturesTargetPath,
    });
    const configPath = path.join(fixturesTargetPath, 'rstest.config.mts');
    const result = await runBrowserWatchCliWithCwd(fixturesTargetPath);
    const { cli } = result;

    try {
      await cli.waitForStdout('Test Files 1 passed');
      await cli.waitForStdout('Waiting for file changes...');

      await sleep(1000);
      cli.resetStd();
      fs.update(configPath, (content) => `${content}\n// trigger restart`);

      await cli.waitForStdout('restarting Rstest');
      await cli.waitForStdout('[browser-global-teardown] executed');
      await cli.waitForStdout('[browser-global-setup] executed');
      await cli.waitForStdout('Test Files 1 passed');
      await cli.waitForStdout('Waiting for file changes...');

      const teardownIndex = cli.stdout.indexOf(
        '[browser-global-teardown] executed',
      );
      const setupIndex = cli.stdout.indexOf('[browser-global-setup] executed');
      const testIndex = cli.stdout.indexOf('Test Files 1 passed');
      expect(setupIndex).toBeGreaterThan(teardownIndex);
      expect(testIndex).toBeGreaterThan(setupIndex);

      cli.exec.process!.stdin!.write('q');
      await result.expectExecSuccess();
      expect(
        cli.stdout.match(/\[browser-global-teardown\] executed/g),
      ).toHaveLength(2);
    } finally {
      await killCliProcessTree(cli);
      await deleteFixtureTarget(fs, fixturesTargetPath);
    }
  }, 60_000);

  it('runs browser globalSetup during a mixed watch session', async () => {
    const result = await runBrowserWatchCli('browser-global-setup-mixed');
    const { cli } = result;

    try {
      await cli.waitForStdout(/✓ .*node\.test\.ts/);
      await cli.waitForStdout(/project-browser.*browserOnly\.test\.ts/);
      await cli.waitForStdout('Waiting for file changes...');

      expect(cli.stdout).toContain('[mixed-node-global-setup] executed');
      expect(cli.stdout).toContain('[mixed-browser-global-setup] executed');
      expect(cli.stdout).toMatch(/✓ .*browserOnly\.test\.ts/);

      await sleep(1000);
      cli.exec.process!.stdin!.write('q');
      await result.expectExecSuccess();

      expect(cli.stdout).toContain('[mixed-node-global-teardown] executed');
      expect(cli.stdout).toContain('[mixed-browser-global-teardown] executed');
    } finally {
      await killCliProcessTree(cli);
    }
  }, 60_000);

  it('reruns node and browser globalSetup after a mixed config restart', async () => {
    const fixturesTargetPath = path.join(
      __dirname,
      'fixtures/fixtures-test-browser-global-setup-mixed-restart',
    );
    const { fs } = await prepareFixtures({
      fixturesPath: path.join(__dirname, 'fixtures/browser-global-setup-mixed'),
      fixturesTargetPath,
    });
    const configPath = path.join(fixturesTargetPath, 'rstest.config.mts');
    fs.update(
      path.join(
        fixturesTargetPath,
        'project-browser/tests/browserOnly.test.ts',
      ),
      (content) =>
        content.replace(
          '() => {\n',
          'async () => {\n  await new Promise((resolve) => setTimeout(resolve, 2000));\n',
        ),
    );
    const result = await runBrowserWatchCliWithCwd(fixturesTargetPath);
    const { cli } = result;

    try {
      await cli.waitForStdout('[mixed-node-global-setup] executed');
      await cli.waitForStdout('[Browser UI] WebSocket server started');
      cli.resetStd();
      fs.update(configPath, (content) => `${content}\n// trigger restart`);

      await cli.waitForStdout('restarting Rstest');
      await cli.waitForStdout('[mixed-node-global-teardown] executed');
      await cli.waitForStdout('[mixed-browser-global-teardown] executed');
      await cli.waitForStdout('[mixed-node-global-setup] executed');
      await cli.waitForStdout('[mixed-browser-global-setup] executed');
      await cli.waitForStdout(/✓ .*node\.test\.ts/);
      await cli.waitForStdout(/✓ .*browserOnly\.test\.ts/);
      await cli.waitForStdout('Waiting for file changes...');

      cli.exec.process!.stdin!.write('q');
      await result.expectExecSuccess();
      expect(
        cli.stdout.match(/\[mixed-node-global-teardown\] executed/g),
      ).toHaveLength(2);
      expect(
        cli.stdout.match(/\[mixed-browser-global-teardown\] executed/g),
      ).toHaveLength(2);
    } finally {
      await killCliProcessTree(cli);
      await deleteFixtureTarget(fs, fixturesTargetPath);
    }
  }, 60_000);

  it('runs browser globalSetup in mixed watch when only browser tests are selected', async () => {
    const result = await runBrowserWatchCli('browser-global-setup-mixed', {
      args: ['project-browser/tests/browserOnly.test.ts'],
    });
    const { cli } = result;

    try {
      await cli.waitForStdout(/✓ .*browserOnly\.test\.ts/);
      await cli.waitForStdout('Waiting for file changes...');

      expect(cli.stdout).toContain('[mixed-browser-global-setup] executed');
      expect(cli.stdout).not.toContain('[mixed-node-global-setup] executed');

      await sleep(1000);
      cli.exec.process!.stdin!.write('q');
      await result.expectExecSuccess();

      expect(cli.stdout).toContain('[mixed-browser-global-teardown] executed');
      expect(cli.stdout).not.toContain('[mixed-node-global-teardown] executed');
    } finally {
      await killCliProcessTree(cli);
    }
  }, 60_000);

  it('fails a browser-only watch run before tests when globalSetup throws', async () => {
    const { cli, expectExecFailed, expectStderrLog } = await runBrowserWatchCli(
      'browser-global-setup-error',
    );

    await expectExecFailed();

    expectStderrLog(/Global setup failed intentionally/);
    expect(cli.log).not.toContain('This should not be printed');
  });
});
