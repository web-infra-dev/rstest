import { describe, expect, it } from '@rstest/core';
import { runBrowserCli } from './utils';

/**
 * Phase 4 step 3 gate: a multi-project browser run where one browser project
 * matches zero test files and another has a real test. The empty browser project
 * is still `browser.enabled`, so it is served/launched like any other; its
 * emptiness must not hang or fail the run, and the non-empty project's test still
 * runs to completion.
 */
describe.sequential('browser mode - empty browser project', () => {
  it('runs the non-empty project when a sibling browser project is empty', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli(
      'browser-empty-project',
    );

    await expectExecSuccess();
    expect(cli.stdout).toContain('full.test.ts');
    expect(cli.stdout).toMatch(/Tests.*1 passed/);
    // The empty browser project must not surface as a failure.
    expect(cli.stdout).not.toContain('placeholder');
  });
});
