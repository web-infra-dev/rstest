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
});
