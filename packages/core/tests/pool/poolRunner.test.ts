import { EventEmitter } from 'node:events';
import { FIXTURE_CLEANUP_TIMEOUT_MS } from '../../src/utils/constants';
import { PoolRunner } from '../../src/pool/poolRunner';
import type { Envelope, WorkerRequest } from '../../src/pool/protocol';
import { wrapWorkerResponse } from '../../src/pool/protocol';
import type { PoolTask } from '../../src/pool/types';
import type {
  PoolWorker,
  PoolWorkerEventName,
  PoolWorkerEvents,
} from '../../src/pool/poolWorker';

class CleanupTimeoutWorker implements PoolWorker {
  readonly name = 'cleanup-timeout-worker';
  private readonly events = new EventEmitter();

  async start(): Promise<void> {}

  async stop(): Promise<void> {
    throw new Error('The in-memory worker has no child process to stop.');
  }

  send(request: WorkerRequest): void {
    if (request.type === 'start') {
      queueMicrotask(() => {
        this.events.emit(
          'message',
          wrapWorkerResponse({ type: 'started', pid: 1 }),
        );
      });
      return;
    }
    if (request.type !== 'run') {
      return;
    }
    this.events.emit(
      'message',
      wrapWorkerResponse({
        type: 'fileCleanupStarted',
        taskId: request.taskId,
        result: {
          coverageRaw: { preserved: true },
          meta: { preserved: true },
          name: '',
          project: 'default',
          results: [],
          snapshotResult: {
            added: 1,
            fileDeleted: false,
            filepath: '/test.ts.snap',
            matched: 0,
            unchecked: 0,
            uncheckedKeys: [],
            unmatched: 0,
            updated: 0,
          },
          status: 'pass',
          testId: 'file:/test.ts',
          testPath: '/test.ts',
        },
      }),
    );
  }

  sendRaw(_envelope: Envelope): void {}

  on<E extends PoolWorkerEventName>(
    event: E,
    listener: PoolWorkerEvents[E],
  ): void {
    this.events.on(event, listener);
  }

  off<E extends PoolWorkerEventName>(
    event: E,
    listener: PoolWorkerEvents[E],
  ): void {
    this.events.off(event, listener);
  }

  getCapturedStderr(): string {
    return '';
  }

  resetCapturedStderr(): void {}

  async waitForStderrSettle(): Promise<void> {}

  hasLiveChild(): boolean {
    return false;
  }
}

class WorkerCleanupErrorWorker implements PoolWorker {
  readonly name = 'worker-cleanup-error-worker';
  private readonly events = new EventEmitter();
  private live = true;
  cleanupRequests = 0;

  async start(): Promise<void> {}

  async stop(): Promise<void> {
    this.live = false;
    queueMicrotask(() => this.events.emit('exit', 0, null));
  }

  send(request: WorkerRequest): void {
    if (request.type === 'start') {
      queueMicrotask(() => {
        this.events.emit(
          'message',
          wrapWorkerResponse({ type: 'started', pid: 1 }),
        );
      });
      return;
    }
    if (request.type === 'cleanup') {
      this.cleanupRequests++;
      queueMicrotask(() => {
        this.events.emit(
          'message',
          wrapWorkerResponse({ type: 'cleanupFinished' }),
        );
      });
      return;
    }
    if (request.type !== 'run') {
      return;
    }
    this.events.emit(
      'message',
      wrapWorkerResponse({
        type: 'fileCleanupStarted',
        taskId: request.taskId,
      }),
    );
    this.events.emit(
      'message',
      wrapWorkerResponse({
        type: 'workerCleanupStarted',
        taskId: request.taskId,
      }),
    );
    this.events.emit(
      'message',
      wrapWorkerResponse({
        type: 'workerCleanupFinished',
        taskId: request.taskId,
        error: { message: 'worker cleanup failed' },
      }),
    );
    this.events.emit(
      'message',
      wrapWorkerResponse({
        type: 'runFinished',
        taskId: request.taskId,
        result: {
          coverageRaw: { preserved: true },
          name: '',
          project: 'default',
          results: [],
          status: 'fail',
          testId: 'file:/test.ts',
          testPath: '/test.ts',
          errors: [{ message: 'worker cleanup failed' }],
        },
      }),
    );
  }

  sendRaw(_envelope: Envelope): void {}

  on<E extends PoolWorkerEventName>(
    event: E,
    listener: PoolWorkerEvents[E],
  ): void {
    this.events.on(event, listener);
  }

  off<E extends PoolWorkerEventName>(
    event: E,
    listener: PoolWorkerEvents[E],
  ): void {
    this.events.off(event, listener);
  }

  getCapturedStderr(): string {
    return '';
  }

  resetCapturedStderr(): void {}

  async waitForStderrSettle(): Promise<void> {}

  hasLiveChild(): boolean {
    return this.live;
  }
}

class MemoryReportingWorker implements PoolWorker {
  readonly name = 'memory-reporting-worker';
  private readonly events = new EventEmitter();
  private live = true;

  async start(): Promise<void> {}

  async stop(): Promise<void> {
    this.live = false;
    queueMicrotask(() => this.events.emit('exit', 0, null));
  }

  send(request: WorkerRequest): void {
    if (request.type === 'start') {
      queueMicrotask(() => {
        this.events.emit(
          'message',
          wrapWorkerResponse({ type: 'started', pid: 1 }),
        );
      });
      return;
    }
    if (request.type === 'run') {
      queueMicrotask(() => {
        this.events.emit(
          'message',
          wrapWorkerResponse({
            type: 'runFinished',
            taskId: request.taskId,
            result: {
              name: '',
              project: 'default',
              results: [],
              status: 'pass',
              testId: 'file:/test.ts',
              testPath: '/test.ts',
            },
            memory: { heapUsed: 101 },
          }),
        );
      });
    }
  }

  sendRaw(_envelope: Envelope): void {}

  on<E extends PoolWorkerEventName>(
    event: E,
    listener: PoolWorkerEvents[E],
  ): void {
    this.events.on(event, listener);
  }

  off<E extends PoolWorkerEventName>(
    event: E,
    listener: PoolWorkerEvents[E],
  ): void {
    this.events.off(event, listener);
  }

  getCapturedStderr(): string {
    return '';
  }

  resetCapturedStderr(): void {}

  async waitForStderrSettle(): Promise<void> {}

  hasLiveChild(): boolean {
    return this.live;
  }
}

const createTask = (): PoolTask =>
  ({
    options: {},
    rpcMethods: {},
    type: 'run',
    worker: 'forks',
  }) as PoolTask;

describe('PoolRunner file fixture cleanup watchdog', () => {
  it('preserves the provisional file result when cleanup times out', async () => {
    rs.useFakeTimers();
    const runner = new PoolRunner(new CleanupTimeoutWorker(), {
      environmentKey: 'node',
      workerId: 1,
    });
    try {
      await runner.start();
      const resultPromise = runner.runTest(createTask());

      await rs.advanceTimersByTimeAsync(FIXTURE_CLEANUP_TIMEOUT_MS);

      await expect(resultPromise).resolves.toEqual(
        expect.objectContaining({
          coverageRaw: { preserved: true },
          meta: { preserved: true },
          snapshotResult: expect.objectContaining({ added: 1 }),
          status: 'fail',
          errors: [
            expect.objectContaining({
              message: `File fixture cleanup did not finish within ${FIXTURE_CLEANUP_TIMEOUT_MS}ms`,
            }),
          ],
        }),
      );
    } finally {
      rs.useRealTimers();
      await runner.stop();
    }
  });
});

describe('PoolRunner worker fixture cleanup', () => {
  it('keeps the completed result when worker cleanup reports an error', async () => {
    const runner = new PoolRunner(new WorkerCleanupErrorWorker(), {
      environmentKey: 'node',
      workerId: 1,
    });

    await runner.start();
    await expect(runner.runTest(createTask())).resolves.toEqual(
      expect.objectContaining({
        coverageRaw: { preserved: true },
        status: 'fail',
        errors: [expect.objectContaining({ message: 'worker cleanup failed' })],
      }),
    );
    expect(runner.isUsable()).toBe(false);
    await runner.stop();
  });

  it('coalesces concurrent worker cleanup requests', async () => {
    const worker = new WorkerCleanupErrorWorker();
    const runner = new PoolRunner(worker, {
      environmentKey: 'node',
      workerId: 1,
    });

    await runner.start();
    const cleanupPromise = runner.cleanupWorkerFixtures();
    const stopPromise = runner.stop();
    await Promise.all([cleanupPromise, stopPromise]);

    expect(worker.cleanupRequests).toBe(1);
  });
});

describe('PoolRunner VM worker memory limit', () => {
  it('marks a runner for recycling after a worker reports heap over the limit', async () => {
    const runner = new PoolRunner(new MemoryReportingWorker(), {
      environmentKey: 'jsdom',
      vmMemoryLimit: 100,
      workerId: 1,
    });

    await runner.start();
    expect(runner.shouldRecycle()).toBe(false);
    await runner.runTest(createTask());
    expect(runner.shouldRecycle()).toBe(true);
    await runner.stop({ force: true });
  });
});
