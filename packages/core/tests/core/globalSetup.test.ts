import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { afterAll, describe, expect, it, rs } from '@rstest/core';
import {
  claimGlobalSetupOnce,
  GlobalSetupWorker,
  runGlobalSetup,
} from '../../src/core/globalSetup';

// Self-contained fake of the globalSetup IPC child: replies to every `setup`
// message with a successful result carrying a fixed env change-set, so
// `runGlobalSetup` (which forks internally) is testable without a real child.
rs.mock('node:child_process', () => {
  const fork = () => {
    const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
    return {
      stdout: undefined,
      stderr: undefined,
      // Non-null exit code so `killAndWait` treats the child as already gone.
      exitCode: 0,
      signalCode: null,
      on(event: string, cb: (...args: unknown[]) => void) {
        listeners.set(event, [...(listeners.get(event) ?? []), cb]);
        return this;
      },
      once(event: string, cb: (...args: unknown[]) => void) {
        return this.on(event, cb);
      },
      off() {
        return this;
      },
      kill: () => true,
      send(
        message: { id: number; type: 'setup' | 'teardown' },
        callback?: (error: Error | null) => void,
      ) {
        callback?.(null);
        queueMicrotask(() => {
          for (const cb of listeners.get('message') ?? []) {
            cb({
              __rstest_global_setup__: true,
              id: message.id,
              result:
                message.type === 'setup'
                  ? {
                      success: true,
                      hasTeardown: false,
                      envChanges: { RSTEST_GS_UNIT: 'from-worker' },
                    }
                  : { success: true },
            });
          }
        });
        return true;
      },
    };
  };
  return { fork };
});

afterAll(() => {
  rs.doUnmock('node:child_process');
  delete process.env.RSTEST_GS_UNIT;
});

describe('claimGlobalSetupOnce', () => {
  it('claims the gate once when there are running tests and setup entries', () => {
    const project = { _globalSetups: false };
    expect(claimGlobalSetupOnce(project, 3, 1)).toBe(true);
    expect(project._globalSetups).toBe(true);
    // Idempotent: a second call does not re-run setup.
    expect(claimGlobalSetupOnce(project, 3, 1)).toBe(false);
  });

  it('does not claim when there are no running tests', () => {
    const project = { _globalSetups: false };
    expect(claimGlobalSetupOnce(project, 0, 1)).toBe(false);
    expect(project._globalSetups).toBe(false);
  });

  it('does not claim when there are no global setup entries', () => {
    const project = { _globalSetups: false };
    expect(claimGlobalSetupOnce(project, 3, 0)).toBe(false);
    expect(project._globalSetups).toBe(false);
  });

  it('does not re-claim when the marker is already set', () => {
    const project = { _globalSetups: true };
    expect(claimGlobalSetupOnce(project, 3, 1)).toBe(false);
    expect(project._globalSetups).toBe(true);
  });
});

class MockChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  sendCallback: ((error: Error | null) => void) | undefined;

  send(_message: unknown, callback?: (error: Error | null) => void): boolean {
    this.sendCallback = callback;
    return true;
  }
}

const createWorker = (child: MockChildProcess): GlobalSetupWorker =>
  new GlobalSetupWorker(() => child as unknown as ChildProcess);

describe('GlobalSetupWorker', () => {
  it('should reject when IPC send reports an error', async () => {
    const child = new MockChildProcess();
    const worker = createWorker(child);
    const promise = worker.call({ type: 'teardown' });

    expect(child.sendCallback).toBeTypeOf('function');
    child.sendCallback!(new Error('send failed'));

    await expect(promise).rejects.toThrow('send failed');
  });

  it('should reject pending calls when worker emits an error', async () => {
    const child = new MockChildProcess();
    const worker = createWorker(child);
    const promise = worker.call({ type: 'teardown' });

    child.emit('error', new Error('worker error'));

    await expect(promise).rejects.toThrow('worker error');
  });
});

describe('runGlobalSetup', () => {
  it('surfaces the worker env change-set and applies it to process.env', async () => {
    const result = await runGlobalSetup({
      globalSetupEntries: [],
      assetFiles: {},
      sourceMaps: {},
      interopDefault: true,
      outputModule: false,
    });

    expect(result.success).toBe(true);
    expect(result.envChanges).toEqual({ RSTEST_GS_UNIT: 'from-worker' });
    // The change-set is also applied to the host env (node pool reads it).
    expect(process.env.RSTEST_GS_UNIT).toBe('from-worker');
  });
});
