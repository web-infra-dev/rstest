import { describe, expect, it } from '@rstest/core';
import { runBrowserCli } from './utils';

describe('browser mode - setup files', () => {
  it('should execute setup files before tests', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli('setup-files');

    await expectExecSuccess();
    expect(cli.stdout).toMatch(/Tests.*passed/);
  });

  it('should keep setup hooks in later non-isolated files', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli('setup-files', {
      args: [
        '--isolate=false',
        '--pool.maxWorkers=1',
        'tests/index.test.ts',
        'tests/second.test.ts',
      ],
    });

    await expectExecSuccess();
    expect(cli.stdout).toContain('RSTEST_SETUP_BEFORE_EACH_4');
  });
});
