import { describe, expect, it } from '@rstest/core';
import { runBrowserCli } from './utils';

describe('browser mode - @testing-library/react', () => {
  it('should run @testing-library/react tests in browser mode', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli('testing-library');

    await expectExecSuccess();
    expect(cli.stdout).toMatch(/Tests.*passed/);
  });

  it('should pass all @testing-library/react tests', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli('testing-library');

    await expectExecSuccess();
    expect(cli.stdout).toMatch(/Test Files.*passed/);
  });

  it('should run all 9 tests successfully', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli('testing-library');

    await expectExecSuccess();
    // Verify all 9 tests passed
    expect(cli.stdout).toMatch(/Tests\s+9 passed/);
  });

  it('should exit with code 0 when all tests pass', async () => {
    const { cli } = await runBrowserCli('testing-library');

    await cli.exec;
    expect(cli.exec.exitCode).toBe(0);
  });
});
