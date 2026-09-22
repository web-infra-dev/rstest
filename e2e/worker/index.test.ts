import { fork } from 'node:child_process';
import { once } from 'node:events';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts/';
import { coreDist } from '../scripts/utils';

const __filename = fileURLToPath(import.meta.url);

const __dirname = dirname(__filename);
const fixtureDir = join(__dirname, 'fixtures');
const workerEntry = join(coreDist, 'worker.js');

describe('test worker behavior', () => {
  for (const mode of ['SIGINT', 'disconnect']) {
    describe.skipIf(process.platform === 'win32' && mode === 'SIGINT')(
      `built worker (${mode})`,
      () => {
        it.for([mode])(
          'honors the host termination policy in the built worker (%s)',
          async (mode) => {
            const child = fork(workerEntry, [], {
              // An active handle prevents a missing disconnect handler from passing
              // merely because the worker has no other work keeping it alive.
              execArgv: [
                '--import',
                'data:text/javascript,setInterval(() => {}, 1000)',
              ],
              stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
            });
            const exited = once(child, 'exit');
            try {
              const started = once(child, 'message', {
                signal: AbortSignal.timeout(5000),
              });
              child.send({
                __rstest_worker_request__: true,
                request: { type: 'start', workerId: 1 },
              });
              const [message] = await started;
              expect(message).toMatchObject({
                __rstest_worker_response__: true,
                response: { type: 'started', pid: child.pid },
              });

              if (mode === 'SIGINT') {
                child.kill('SIGINT');
                expect(
                  await Promise.race([
                    exited.then(() => 'exited'),
                    delay(100, 'alive'),
                  ]),
                ).toBe('alive');
                child.kill('SIGTERM');
                expect(
                  await Promise.race([
                    exited,
                    delay(1000, 'still alive', { ref: false }),
                  ]),
                ).toEqual([null, 'SIGTERM']);
              } else {
                child.disconnect();
                expect(
                  await Promise.race([
                    exited,
                    delay(1000, 'still alive', { ref: false }),
                  ]),
                ).toEqual([0, null]);
              }
            } finally {
              if (child.exitCode === null && child.signalCode === null) {
                child.kill('SIGKILL');
              }
              await exited;
            }
          },
        );
      },
    );
  }

  it.for(['run', 'list'])(
    'does not swallow an uncaught error during VM handler handoff (%s)',
    async (command) => {
      const { expectExecFailed, cli } = await runRstestCli({
        command: 'rstest',
        args: [command, 'unhandledRejection.test.ts', '--pool', 'vmThreads'],
        options: {
          nodeOptions: {
            cwd: fixtureDir,
            env: { RSTEST_VM_TEARDOWN_ERROR: 'true' },
          },
        },
      });
      await expectExecFailed();
      expect(cli.log).toContain('VM_TEARDOWN_UNCAUGHT');
    },
  );
  it('should output node warnings correctly', async () => {
    const { expectExecSuccess, expectStderrLog, cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'node.warning.test.ts'],
      options: {
        nodeOptions: {
          cwd: fixtureDir,
        },
      },
    });

    await expectExecSuccess();
    expectStderrLog(/MaxListenersExceededWarning/);
    // ExperimentalWarning should be suppressed
    expect(cli.log).not.toContain('ExperimentalWarning');
  });

  it('should include worker stderr in summary when worker exits unexpectedly', async () => {
    const marker = 'RSTEST_WORKER_PANIC_MARKER';
    const { expectExecFailed, cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'worker.panic.test.ts'],
      options: {
        nodeOptions: {
          cwd: fixtureDir,
        },
      },
    });

    await expectExecFailed();
    expect(cli.log).toContain('Worker exited unexpectedly');
    expect(cli.log).toContain('Maybe related stderr');
    expect(cli.log).toContain(marker);
  });

  it('should report the running test case as failed when worker exits unexpectedly', async () => {
    const { expectExecFailed, cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'worker.panic.test.ts'],
      options: {
        nodeOptions: {
          cwd: fixtureDir,
        },
      },
    });

    await expectExecFailed();
    // The case that was running at crash time is attributed as a failed test
    // case rather than silently dropped from the counts (#1535).
    expect(cli.log).toContain('should crash the worker process');
    expect(cli.stdout).toMatch(/Tests\s+1 failed/);
  });

  it('should handle unhandledRejection error correctly', async () => {
    const { expectExecFailed, expectStderrLog } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'unhandledRejection.test.ts'],
      options: {
        nodeOptions: {
          cwd: fixtureDir,
        },
      },
    });

    await expectExecFailed();
    expectStderrLog(/AssertionError: expected 'hello' to be 'hii'/);
  });
});
