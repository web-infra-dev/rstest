import { describe, expect, it } from '@rstest/core';
import { runBrowserCli } from './utils';

// Characterization for the Phase 3 unified finalize: a genuine mixed run (one
// node project + one browser project, both with real tests) must produce a
// single unified verdict whose "Summary of all failing tests" block includes
// BOTH executors' failures. On `main` the browser failure is silently dropped
// from that block because it is filtered by node-only entry paths (Appendix A
// bug 2). This pins the FIXED behavior, so the browser-failure assertion is red
// until the finalize extraction lands.
//
// The `✗` progress lines print every failure inline on stdout regardless of the
// bug, so the assertion targets stderr — where `printSummaryErrorLogs` writes
// the filtered detail block.
describe('browser mode - mixed node + browser run', () => {
  it('lists both node and browser failures in the summary and exits non-zero', async () => {
    const { cli } = await runBrowserCli('mixed', { args: [] });

    await cli.exec;

    expect(cli.exec.exitCode).not.toBe(0);

    // The node failure is always present in the summary block (control).
    expect(cli.stderr).toContain('node-tests/node.test.ts');
    // The browser failure must appear in the same unified summary block.
    expect(cli.stderr).toContain('browser-tests/browser.test.ts');
  });

  it('unifies finalize when only the browser side fails', async () => {
    const { cli } = await runBrowserCli('mixed-browser-fail', { args: [] });

    await cli.exec;

    // Core owns the exit code; the failing browser file raises it to 1 even
    // though every node test passed.
    expect(cli.exec.exitCode).toBe(1);

    // Exactly one unified `onTestRunEnd` fires (no browser self-finalize in
    // non-watch mode).
    const endCounts = cli.stdout.match(/PROBE_ONEND_COUNT=(\d+)/g) ?? [];
    expect(endCounts).toEqual(['PROBE_ONEND_COUNT=1']);

    // The single finalize sums both executors' durations into one verdict.
    const durationJson = cli.stdout.match(/PROBE_ONEND_DURATION=(\{.*\})/)?.[1];
    expect(durationJson).toBeDefined();
    const duration = JSON.parse(durationJson!) as {
      totalTime: number;
      buildTime: number;
      testTime: number;
    };
    expect(duration.totalTime).toBe(duration.buildTime + duration.testTime);
    expect(duration.testTime).toBeGreaterThan(0);

    // The browser failure detail is present in the summary block, and the node
    // side reports no failure of its own.
    expect(cli.stderr).toContain('browser-tests/browser.test.ts');
    expect(cli.stderr).toContain('BROWSER_ONLY_ERR');
    expect(cli.stderr).not.toContain('node-tests/node.test.ts');
  });

  it('rejects an unknown browser name before any node or browser test starts', async () => {
    const { cli } = await runBrowserCli('mixed', {
      args: ['-c', 'rstest.invalid-browser.config.mts'],
    });

    await cli.exec;

    expect(cli.exec.exitCode).not.toBe(0);
    const output = `${cli.stdout}\n${cli.stderr}`;
    expect(output).toMatch(
      /Browser instance must be an object with a `browserName` field/,
    );
    // The node project has real tests too; none of them may have started, and
    // no file result of either side was reported.
    expect(output).not.toMatch(/node\.test\.ts|browser\.test\.ts/);
    expect(output).not.toMatch(/Test Files/);
  });
});
