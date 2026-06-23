import { describe, expect, it } from '@rstest/core';
import { runBrowserCli } from './utils';

describe('browser mode - error handling', () => {
  it('should handle runtime, assertion, and timeout errors', async () => {
    const { expectExecFailed, cli } = await runBrowserCli('error', {
      args: [
        'tests/runtimeError.test.ts',
        'tests/assertionError.test.ts',
        'tests/timeoutError.test.ts',
      ],
    });

    await expectExecFailed();
    expect(cli.stdout).toMatch(/fail|timeout/i);
    expect(cli.stdout).toMatch(/nonExistent|Cannot read/);
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
