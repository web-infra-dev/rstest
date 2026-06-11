import { describe, expect, it } from '@rstest/core';
import { runBrowserCli } from './utils';

/**
 * Regression test for https://github.com/web-infra-dev/rstest/issues/1363.
 * The `multi-project-config` fixture carries an empty node project alongside its
 * browser projects; filtering to a single browser test leaves the node project
 * with zero tests, which is the mixed "no node tests to run" shape that hung.
 *
 * `expectExecSuccess()` awaits process exit, so a regression here surfaces as a
 * test timeout rather than a wrong assertion.
 */
describe('browser mode - multi project exit', () => {
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
