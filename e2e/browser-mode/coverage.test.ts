import { describe, expect, it } from '@rstest/core';
import { runBrowserCli } from './utils';

describe('browser mode - coverage', () => {
  it('should collect coverage data from browser tests', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli('browser-coverage');

    await expectExecSuccess();

    // Verify coverage report is generated
    expect(cli.stdout).toMatch(/Coverage enabled with istanbul/);

    // sum.ts should have 100% coverage (tested)
    expect(cli.stdout.replaceAll(' ', '')).toContain('sum.ts|100|100|100|100');

    // multiply.ts should have 0% coverage (untested)
    expect(cli.stdout.replaceAll(' ', '')).toContain('multiply.ts|0|0|0|0');
  });
});
