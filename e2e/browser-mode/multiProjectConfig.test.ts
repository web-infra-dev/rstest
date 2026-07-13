import { describe, expect, it } from '@rstest/core';
import { runBrowserCli } from './utils';

/**
 * Regression test: in multi-project browser mode, each project must compile with
 * its own config instead of inheriting config from the first browser project.
 *
 * This file also covers https://github.com/web-infra-dev/rstest/issues/1363 and
 * https://github.com/web-infra-dev/rstest/issues/1473.
 * Keep these multi-project cases in one file so the browser-mode suite does not
 * start the `multi-project-config` fixture from several test files at once.
 */
describe.sequential('browser mode - multi project config isolation', () => {
  it('should apply each browser project config independently', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli(
      'multi-project-config',
      {
        args: ['project-a/tests/jsxRuntime.test.tsx'],
      },
    );

    await expectExecSuccess();
    expect(cli.stdout).toContain('jsxRuntime.test.tsx');
    expect(cli.stdout).toMatch(/Tests.*passed/);
  });

  it('exits when a node project has no tests but a browser project does', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli(
      'multi-project-config',
      { args: ['project-b/tests/smoke.test.ts'] },
    );

    await expectExecSuccess();
    expect(cli.stdout).toContain('smoke.test.ts');
    expect(cli.stdout).toMatch(/Tests.*passed/);
  });

  // https://github.com/web-infra-dev/rstest/issues/1473
  // Run BOTH browser projects together (no file filter). project-a needs its
  // own `pluginReact` and project-b needs its own `resolve.alias` (`@only-b`).
  // With the old shared rsbuild instance, each project's files were compiled in
  // the other project's environment, so `@only-b` failed to resolve -> "Module
  // not found" -> the whole run hung. Each project now owns an isolated rsbuild
  // instance, so both compile with their own config.
  it('runs all browser projects together with divergent per-project config', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli(
      'multi-project-config',
    );

    await expectExecSuccess();
    expect(cli.stdout).toContain('jsxRuntime.test.tsx');
    expect(cli.stdout).toContain('smoke.test.ts');
    expect(cli.stdout).toMatch(/Tests.*2 passed/);
  });

  it('runs mixed-mode browser tests added by modifyRstestConfig hooks', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli(
      'modify-rstest-mixed',
      {
        args: [
          '--project',
          'project-hooked-browser',
          '--project',
          'node-smoke',
        ],
      },
    );

    await expectExecSuccess();
    expect(cli.stdout).toContain('hooked-browser.test.ts');
    expect(cli.stdout).toContain('node-smoke.test.ts');
    expect(cli.stdout).toMatch(/Tests.*2 passed/);
  });

  it('runs filtered mixed-mode browser tests added by modifyRstestConfig hooks', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli(
      'modify-rstest-mixed',
      {
        args: [
          '--project',
          'project-hooked-browser',
          '--project',
          'node-smoke',
          'project-hooked-browser/tests-added/hooked-browser.test.ts',
        ],
      },
    );

    await expectExecSuccess();
    expect(cli.stdout).toContain('hooked-browser.test.ts');
    expect(cli.stdout).not.toContain('node-smoke.test.ts');
    expect(cli.stdout).toMatch(/Tests.*1 passed/);
  });

  it('runs fuzzy-filtered mixed-mode browser tests added by modifyRstestConfig hooks', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli(
      'modify-rstest-mixed',
      {
        args: [
          '--project',
          'project-hooked-browser',
          '--project',
          'node-smoke',
          'hooked-browser.test.ts',
        ],
      },
    );

    await expectExecSuccess();
    expect(cli.stdout).toContain('hooked-browser.test.ts');
    expect(cli.stdout).not.toContain('node-smoke.test.ts');
    expect(cli.stdout).toMatch(/Tests.*1 passed/);
  });

  it('fails explicit browser path filters that still match no tests after hooks', async () => {
    const { expectExecFailed, cli } = await runBrowserCli(
      'modify-rstest-mixed',
      {
        args: [
          '--project',
          'project-hooked-browser',
          '--project',
          'node-smoke',
          'project-hooked-browser/tests-added/missing.test.ts',
        ],
      },
    );

    await expectExecFailed();
    expect(cli.stderr).toContain('No test files found');
    expect(cli.stdout).not.toContain('node-smoke.test.ts');
  });

  it('keeps browser shard manifests in sync after all project hooks run', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli(
      'modify-rstest-mixed',
      {
        args: [
          '--shard=1/2',
          '--project',
          'project-hooked-a',
          '--project',
          'project-hooked-b',
        ],
      },
    );

    await expectExecSuccess();
    expect(cli.stdout).toContain('hooked-a.test.ts');
    expect(cli.stdout).not.toContain('hooked-b.test.ts');
    expect(cli.stdout).toMatch(/Tests.*1 passed/);
  });

  it('keeps mixed node and browser shard planning in sync after browser hooks run', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli(
      'modify-rstest-mixed',
      {
        args: [
          '--shard=2/2',
          '--project',
          'project-hooked-browser',
          '--project',
          'node-smoke',
        ],
      },
    );

    await expectExecSuccess();
    expect(cli.stdout).toContain('hooked-browser.test.ts');
    expect(cli.stdout).not.toContain('node-smoke.test.ts');
    expect(cli.stdout).toMatch(/Tests.*1 passed/);
  });
});
