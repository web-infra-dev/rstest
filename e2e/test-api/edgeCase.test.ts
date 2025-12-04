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
    const { expectExecFailed, expectLog } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/errorString.test.ts'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });
    await expectExecFailed();

    expectLog('Unknown Error: aaaa');
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
    expectLog("import('aaa')", logs);
  });

  it('should log build error message correctly', async () => {
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
    const { expectExecFailed, expectLog } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/circularReference.test.ts'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });
    await expectExecFailed();

    expectLog(/AssertionError: expected .* to deeply equal undefined/);
  });
});
