import { describe, expect, it } from '@rstest/core';
import { runBrowserCli } from './utils';

describe('browser mode - moduleNameMapper', () => {
  it('should resolve modules using moduleNameMapper config', async () => {
    const { expectExecSuccess, cli } =
      await runBrowserCli('module-name-mapper');

    await expectExecSuccess();
    expect(cli.stdout).toMatch(/Tests.*2 passed/);
  });
});
