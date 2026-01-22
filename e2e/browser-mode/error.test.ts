import { describe, expect, it } from '@rstest/core';
import { runBrowserCli } from './utils';

describe('browser mode - error handling', () => {
  it('should handle runtime errors', async () => {
    const { expectExecFailed, cli } = await runBrowserCli('error', {
      args: ['tests/runtimeError.test.ts'],
    });

    await expectExecFailed();
    expect(cli.stdout).toMatch(/fail/i);
  });

  it('should handle test timeout', async () => {
    const { expectExecFailed, cli } = await runBrowserCli('error', {
      args: ['tests/timeoutError.test.ts'],
    });

    await expectExecFailed();
    expect(cli.stdout).toMatch(/fail|timeout/i);
  });

  it('should handle assertion errors', async () => {
    const { expectExecFailed, cli } = await runBrowserCli('error', {
      args: ['tests/assertionError.test.ts'],
    });

    await expectExecFailed();
    expect(cli.stdout).toMatch(/fail/i);
    expect(cli.stdout).toMatch(/expected.*to.*be/i);
  });

  it('should exit with non-zero code when tests fail', async () => {
    const { cli } = await runBrowserCli('error', {
      args: ['tests/assertionError.test.ts'],
    });

    await cli.exec;
    expect(cli.exec.exitCode).not.toBe(0);
  });
});
