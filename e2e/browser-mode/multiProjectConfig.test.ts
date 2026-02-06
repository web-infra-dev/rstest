import { describe, expect, it } from '@rstest/core';
import { runBrowserCli } from './utils';

/**
 * Regression test: in multi-project browser mode, each project must compile with
 * its own config instead of inheriting config from the first browser project.
 */
describe('browser mode - multi project config isolation', () => {
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
});
