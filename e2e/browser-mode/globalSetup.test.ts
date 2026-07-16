import { describe, expect, it } from '@rstest/core';
import { runBrowserCli } from './utils';

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
});
