import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('detect async leaks', () => {
  it('fails the test file when async resources are leaked', async ({
    onTestFinished,
  }) => {
    const { cli, expectExecFailed, expectStderrLog } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/leak.test', '--detectAsyncLeaks'],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await expectExecFailed();
    expectStderrLog('AsyncLeakError');
    expectStderrLog(
      'Detected async leak: Timeout was still active after async leak > leaks a timer finished.',
    );
    expect(cli.stderr).toContain('leak.test.ts');
  });

  it('passes when async resources are cleaned up', async ({
    onTestFinished,
  }) => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/noLeak.test', '--detectAsyncLeaks'],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await expectExecSuccess();
  });

  it('passes when zlib streams have emitted close', async ({
    onTestFinished,
  }) => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/zlibClosed.test', '--detectAsyncLeaks'],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await expectExecSuccess();
  });

  it('passes when fake timers are still active', async ({ onTestFinished }) => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/fakeTimers.test', '--detectAsyncLeaks'],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await expectExecSuccess();
  });

  it('restores a date-only setSystemTime pin so it does not leak across files', async ({
    onTestFinished,
  }) => {
    // a.test pins a Date-only mock without useRealTimers(); under isolate:false
    // the cleanup must restore the real Date before b.test runs in the same
    // reused worker. Regression test for the leak-cleanup predicate that
    // previously only fired for full fake timers.
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--detectAsyncLeaks'],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures', 'dateOnlyReset'),
        },
      },
    });

    await expectExecSuccess();
  });
});
