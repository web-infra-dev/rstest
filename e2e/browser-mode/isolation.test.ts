import { describe, expect, it } from '@rstest/core';
import { runBrowserCli } from './utils';

describe('browser mode - isolation', () => {
  it('should isolate test files in separate iframes', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli('isolation');

    await expectExecSuccess();
    // Both files should pass, meaning they are isolated
    expect(cli.stdout).toMatch(/Test Files.*2.*passed/);
  });

  it('should isolate global variables between files', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli('isolation', {
      args: ['tests/file2.test.ts'],
    });

    await expectExecSuccess();
    // file2 checks that __FILE1_VAR__ is undefined
    expect(cli.stdout).toMatch(/should not see global variable from file1/);
  });

  it('should isolate DOM between files', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli('isolation', {
      args: ['tests/file2.test.ts'],
    });

    await expectExecSuccess();
    // file2 checks that #file1-element doesn't exist
    expect(cli.stdout).toMatch(/should not see DOM element from file1/);
  });
});
