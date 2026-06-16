import { describe, expect, it } from '@rstest/core';
import { runBrowserCli } from './utils';

/**
 * Regression test: in multi-project browser mode, each project must compile with
 * its own config instead of inheriting config from the first browser project.
 *
 * This file also covers https://github.com/web-infra-dev/rstest/issues/1363.
 * Keep these multi-project cases in one file so the browser-mode suite does not
 * start two independent `multi-project-config` fixtures at once; all projects in
 * that fixture intentionally share one browser server port.
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
});
