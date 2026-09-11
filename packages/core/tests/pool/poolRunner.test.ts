import { EventEmitter } from 'node:events';
import {
  FIXTURE_CLEANUP_TIMEOUT_MS,
  WORKER_CLEANUP_TIMEOUT_MS,
} from '../../src/utils/constants';
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

  constructor(private readonly finishInTaskCleanup = true) {}

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
    if (!this.finishInTaskCleanup) {
      return;
    }
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
          errors: [{ name: 'Error', message: 'worker cleanup failed' }],
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

class WorkerCleanupTimeoutWorker extends WorkerCleanupErrorWorker {
  override send(request: WorkerRequest): void {
    if (request.type === 'cleanup') return;
    super.send(request);
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
            memory: { heapUsed: 101, rss: 201 },
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
  it('uses the longer watchdog for in-task worker cleanup', async () => {
    rs.useFakeTimers();
    const runner = new PoolRunner(new WorkerCleanupErrorWorker(false), {
      environmentKey: 'node',
      workerId: 1,
    });

    try {
      await runner.start();
      const runPromise = runner.runTest(createTask());
      let settled = false;
      void runPromise.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );

      await rs.advanceTimersByTimeAsync(FIXTURE_CLEANUP_TIMEOUT_MS);
      expect(settled).toBe(false);

      await rs.advanceTimersByTimeAsync(
        WORKER_CLEANUP_TIMEOUT_MS - FIXTURE_CLEANUP_TIMEOUT_MS,
      );
      await expect(runPromise).rejects.toThrow(
        `Worker fixture cleanup did not finish within ${WORKER_CLEANUP_TIMEOUT_MS}ms`,
      );
    } finally {
      rs.useRealTimers();
      await runner.stop();
    }
  });

  it('uses the longer watchdog for final worker cleanup', async () => {
    rs.useFakeTimers();
    const runner = new PoolRunner(new WorkerCleanupTimeoutWorker(), {
      environmentKey: 'node',
      workerId: 1,
    });

    try {
      await runner.start();
      const cleanupPromise = runner.cleanupWorkerFixtures();
      const rejection = expect(cleanupPromise).rejects.toThrow(
        `Worker fixture cleanup did not finish within ${WORKER_CLEANUP_TIMEOUT_MS}ms`,
      );

      await rs.advanceTimersByTimeAsync(WORKER_CLEANUP_TIMEOUT_MS);
      await rejection;
    } finally {
      rs.useRealTimers();
      await runner.stop();
    }
  });

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
      memoryLimit: 100,
      workerId: 1,
    });

    await runner.start();
    expect(runner.shouldRecycle()).toBe(false);
    await runner.runTest(createTask());
    expect(runner.shouldRecycle()).toBe(true);
    await runner.stop({ force: true });
  });
});

describe('PoolRunner RSS limit', () => {
  it.for([
    { memoryMetric: 'rss', memoryLimit: 200, recycle: true },
    { memoryMetric: 'rss', memoryLimit: 201, recycle: true },
    { memoryMetric: 'rss', memoryLimit: 202, recycle: false },
    { memoryMetric: 'heapUsed', memoryLimit: 200, recycle: false },
  ] as const)(
    '$memoryMetric at $memoryLimit bytes',
    async ({ memoryMetric, memoryLimit, recycle }) => {
      const runner = new PoolRunner(new MemoryReportingWorker(), {
        environmentKey: 'node',
        workerId: 1,
        memoryMetric,
        memoryLimit,
      });
      try {
        await runner.start();
        await runner.runTest(createTask());
        expect(runner.shouldRecycle()).toBe(recycle);
      } finally {
        await runner.stop({ force: true });
      }
    },
  );
});
