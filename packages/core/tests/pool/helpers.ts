import { EventEmitter } from 'node:events';
import type { PoolWorker } from '../../src/pool/poolWorker';
import {
  wrapWorkerResponse,
  type WorkerRequest,
} from '../../src/pool/protocol';
import type { PoolTask } from '../../src/pool/types';

export class ControlledWorker extends EventEmitter implements PoolWorker {
  readonly name = 'controlled';
  live = true;
  request?: Extract<WorkerRequest, { type: 'run' }>;
  constructor(private readonly autoFinish = false) {
    super();
  }
  async start() {}
  async stop() {
    this.kill();
  }
  kill() {
    this.live = false;
    this.emit('exit', null, 'SIGKILL');
  }
  send = rs.fn((request: WorkerRequest) => {
    if (!this.live) return;
    if (request.type === 'start') {
      queueMicrotask(() =>
        this.emit('message', wrapWorkerResponse({ type: 'started', pid: 1 })),
      );
    } else if (request.type === 'cleanup') {
      this.emit('message', wrapWorkerResponse({ type: 'cleanupFinished' }));
    } else if (request.type === 'run') {
      this.request = request;
      if (this.autoFinish) this.finish();
    }
  });
  finish(status: 'pass' | 'fail' = 'pass') {
    const request = this.request!;
    this.request = undefined;
    this.emit(
      'message',
      wrapWorkerResponse({
        type: 'runFinished',
        taskId: request.taskId,
        result: {
          testId: 'file',
          testPath: '/test.ts',
          project: '',
          name: '',
          status,
          results: [],
        },
      }),
    );
  }
  sendRaw() {}
  getCapturedStderr() {
    return '';
  }
  resetCapturedStderr() {}
  async waitForStderrSettle() {}
  hasLiveChild() {
    return this.live;
  }
}

// Fake workers only consume the scheduler fields, not runtime configuration.
export const task = (): PoolTask =>
  ({
    worker: 'forks',
    type: 'run',
    options: { environmentKey: 'node' },
    rpcMethods: {},
  }) as PoolTask;

export { setImmediate as tick } from 'node:timers/promises';

/** An asset loader that stays pending until `release()` is called. */
export const gatedLoadAssets = <T>(assets: T) => {
  let release!: () => void;
  const loading = new Promise<void>((resolve) => {
    release = resolve;
  });
  const loadAssets = rs.fn(async () => {
    await loading;
    return assets;
  });
  return { loadAssets, release };
};

/**
 * Awaits a pool run that is expected to reject and hands back the rejection so
 * the test can assert on the enriched message. A run that resolves — or rejects
 * with something that carries no message — fails here rather than further down
 * on an `undefined` message.
 */
export const expectRejection = async (
  promise: Promise<unknown>,
): Promise<Error> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }
    throw new Error(
      `Expected the pool run to reject with an Error, got: ${String(error)}`,
    );
  }
  throw new Error('Expected the pool run to reject, but it resolved.');
};
