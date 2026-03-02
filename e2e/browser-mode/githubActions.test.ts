import { describe, expect, it } from '@rstest/core';
import { runBrowserCli } from './utils';

describe('browser mode - github-actions reporter', () => {
  it('should annotate browser failures with test source path', async () => {
    const { expectExecFailed, cli } = await runBrowserCli('github-actions');

    await expectExecFailed();

    const logs = cli.stdout
      .split('\n')
      .filter(Boolean)
      .filter((log) => log.startsWith('::error'));

    expect(logs.length).toBeGreaterThan(0);

    const browserFailure =
      logs.find((log) => log.includes('browser failing test')) || logs[0]!;

    expect(browserFailure).toContain('tests/browser/failing.test.ts');
    expect(browserFailure).not.toContain('http://localhost');
  });
});
