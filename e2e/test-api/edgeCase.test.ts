import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('Test Edge Cases', () => {
  it('no unexpected rpc error about result.expected', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/error.test.ts'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });
    await cli.exec;
    expect(cli.exec.process?.exitCode).toBe(1);

    const logs = cli.stdout.split('\n').filter(Boolean);

    expect(logs.find((log) => log.includes('Error: Symbol('))).toBeFalsy();
  });

  it('should handle error string correctly', async () => {
    const { expectExecFailed, expectStderrLog } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/errorString.test.ts'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });
    await expectExecFailed();

    expectStderrLog('Unknown Error: aaaa');
  });

  it('should report thrown values that are not errors', async () => {
    const { cli, expectExecFailed, expectLog, expectStderrLog } =
      await runRstestCli({
        command: 'rstest',
        args: ['run', 'fixtures/errorNonError.test.ts'],
        options: {
          nodeOptions: {
            cwd: __dirname,
          },
        },
      });
    await expectExecFailed();

    expect(cli.stderr).not.toContain('Cannot read properties of');
    expect(cli.stderr).not.toContain('Unhandled Reporter Error');

    expectStderrLog('Unknown Error: undefined');
    expectStderrLog('Unknown Error: null');
    expectStderrLog('Unknown Error: 404');
    expectStderrLog('Unknown Error: {"code": "E_FAIL"}');
    expectStderrLog('Unknown Error: The thrown value could not be printed');
    expectStderrLog(
      'Unknown Error: {"code": "E_FAIL", "stack": ["remote frame"]}',
    );

    // The other tests in the file keep their own results.
    const logs = cli.stdout.split('\n').filter(Boolean);
    expectLog(/Tests 7 failed \| 2 passed/, logs);
  });

  it('should fail when a hook throws an empty array', async () => {
    const { expectExecFailed, expectStderrLog } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/errorEmptyArray.test.ts'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });
    await expectExecFailed();

    expectStderrLog('Unknown Error: []');
  });

  it('should show fullStack when filtered stack is empty', async () => {
    const { cli, expectExecFailed, expectStderrLog } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/fullStackFallback.test.ts'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });
    await expectExecFailed();

    expect(cli.stderr).not.toContain('No user error stack found');
    expect(cli.stderr).not.toContain('nativeFrame');
    expectStderrLog('at fallbackFrame (node:internal/rstest_fallback:10:5)');
    expectStderrLog('at hiddenFrame (node:internal/rstest_hidden:20:6)');
  });

  it('should print the cause of an error', async () => {
    const { cli, expectExecFailed, expectStderrLog } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/errorCause.test.ts'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });
    await expectExecFailed();

    expectStderrLog('Error: Failed to load the user');
    expectStderrLog('Caused by: Error: Request failed');
    expectStderrLog('Caused by: TypeError: fetch failed');
    // Each cause points at the line that created it.
    expectStderrLog(/at request \(.*errorCause\.test\.ts:5:\d+\)/);
    expectStderrLog(/at loadUser \(.*errorCause\.test\.ts:13:\d+\)/);

    // A cause whose stack is not text is printed without a stack, and the
    // failures after it are still printed.
    expectStderrLog('Caused by: Unknown Error: API failed');
    expect(cli.stderr).not.toContain('Unhandled Reporter Error');

    // An error without a cause is printed as before.
    expectStderrLog('Error: no cause');
    expect(cli.stderr.match(/Caused by: /g)).toHaveLength(3);
  });

  it('should keep an error whose cause cannot be read', async () => {
    const { cli, expectExecFailed, expectLog, expectStderrLog } =
      await runRstestCli({
        command: 'rstest',
        args: ['run', 'fixtures/errorCauseGetter.test.ts'],
        options: {
          nodeOptions: {
            cwd: __dirname,
          },
        },
      });
    await expectExecFailed();

    expectStderrLog('Error: operation failed');
    expect(cli.stderr).not.toContain('metadata unavailable');

    // The other tests in the file keep their own results.
    const logs = cli.stdout.split('\n').filter(Boolean);
    expectLog(/Tests 1 failed \| 2 passed/, logs);
  });

  it('test module not found', async () => {
    // Module not found errors should be silent at build time, and throw errors at runtime
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/moduleNotFound.test.ts'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });
    await expectExecSuccess();

    const logs = cli.stdout.split('\n').filter(Boolean);

    expect(logs.find((log) => log.includes('Build error'))).toBeFalsy();
    expect(logs.find((log) => log.includes('Module not found'))).toBeFalsy();
    expect(logs.find((log) => log.includes('Tests 2 passed'))).toBeTruthy();
  });

  it('test module not found codeFrame', async () => {
    const { cli, expectLog } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/moduleNotFound.codeFrame.test.ts'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });
    await cli.exec;
    const exitCode = cli.exec.process?.exitCode;
    expect(exitCode).toBe(1);

    const logs = cli.stdout.split('\n').filter(Boolean);

    // Module not found error should throw and show code frame correctly
    expectLog('Cannot find module', logs);
    // missing code frame info when module is externaled
    // expectLog("import('aaa')", logs);
  });

  it('should report unhandled style query build errors', async () => {
    const { cli, expectLog } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/lessError.test.ts'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await cli.exec;
    expect(cli.exec.process?.exitCode).toBe(1);

    const logsErr = cli.stderr.split('\n').filter(Boolean);

    // no `× [object Object]`
    expect(logsErr.find((log) => log.includes('[object Object]'))).toBeFalsy();
    expectLog(/To enable support for Less/, logsErr);
  });

  it('only in skip suite', async () => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/onlyInSkip.test.ts'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });
    await cli.exec;
    await expectExecSuccess();

    const logs = cli.stdout.split('\n').filter(Boolean);

    // This behavior is the same as Vitest & Playwright, but it is different from Jest...
    expect(
      logs.find((log) => log.includes('Test Files 1 skipped')),
    ).toBeTruthy();
  });

  it('should handle circular reference in error object correctly', async () => {
    const { expectExecFailed, expectStderrLog } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/circularReference.test.ts'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });
    await expectExecFailed();

    expectStderrLog(/AssertionError: expected .* to deeply equal undefined/);
  });

  it('should not read an error message that ends like a location as a frame', async () => {
    const { cli, expectExecFailed, expectStderrLog } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/errorMessageLocation.test.ts'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });
    await expectExecFailed();

    expectStderrLog('Error: connect ECONNREFUSED 127.0.0.1:5432');
    // The code frame shows the throw, and the message is not listed as a frame.
    expectStderrLog(
      "> 4 |   throw new Error('connect ECONNREFUSED 127.0.0.1:5432');",
    );
    expectStderrLog(/at connect \(.*errorMessageLocation\.test\.ts:4:9\)/);
    expect(cli.stderr).not.toContain('at Error: connect');
  });
});
