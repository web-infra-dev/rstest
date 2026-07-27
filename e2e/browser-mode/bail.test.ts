import { describe, expect, it } from '@rstest/core';
import { runBrowserCli } from './utils';

describe('browser mode - bail', () => {
  it('should stop running remaining files once the bail limit is reached', async () => {
    const { cli } = await runBrowserCli('bail', {
      args: ['--bail=1'],
    });

    await cli.exec;

    // Two files each contain one failing test. With `bail: 1` and a single
    // headless worker, the first file's failure must abort the run before the
    // second file runs — so only one of the two markers reaches the output.
    expect(cli.exec.exitCode).not.toBe(0);

    const combined = `${cli.stdout}\n${cli.stderr}`;
    const markersSeen = ['BAIL_MARKER_A', 'BAIL_MARKER_B'].filter((marker) =>
      combined.includes(marker),
    );
    expect(markersSeen).toHaveLength(1);
  });
});
