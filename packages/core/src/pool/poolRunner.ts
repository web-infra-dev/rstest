import { type BirpcReturn, createBirpc } from 'birpc';
import type { RuntimeRPC, ServerRPC, TestFileResult } from '../types';
import { createFileCleanupTimeoutResult } from '../runtime/runner/fileCleanup';
import { toError } from '../utils';
import { FIXTURE_CLEANUP_TIMEOUT_MS } from '../utils/constants';
import type { PoolWorker } from './poolWorker';
import {
  type CollectTaskResult,
  deserializeError,
  isRpcEnvelope,
  isWorkerResponseEnvelope,
  type TestEnvironmentModuleFallback,
  type WorkerResponse,
  wrapRpc,
} from './protocol';
import type { PoolTask } from './types';

const WORKER_START_TIMEOUT_MS = 90_000;
const MAX_STDERR_MESSAGE_BYTES = 64 * 1024;

function formatCapturedStderr(text: string): string {
  const buf = Buffer.from(text);
  if (buf.length <= MAX_STDERR_MESSAGE_BYTES) {
    return text;
  }
  const half = Math.floor(MAX_STDERR_MESSAGE_BYTES / 2);
  const head = buf.subarray(0, half).toString('utf-8');
  const tail = buf.subarray(-half).toString('utf-8');
  const hiddenBytes = buf.length - half * 2;
  return `${head}\n\n... [truncated ${hiddenBytes} bytes of stderr] ...\n\n${tail}`;
}

type RunnerState =
  'IDLE' | 'STARTING' | 'STARTED' | 'START_FAILURE' | 'STOPPING' | 'STOPPED';

type TaskKind = 'run' | 'collect';

type PendingTask = {
  kind: TaskKind;
  taskId: number;
  provisionalResult?: TestFileResult;
  resolve: (result: TestFileResult | CollectTaskResult) => void;
  reject: (err: Error) => void;
};

type Deferred<T = void> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: Error) => void;
};

const createDeferred = <T = void>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

let nextTaskSeq = 0;

type PoolRunnerOptions = {
  workerId: number;
  environmentKey: string;
  onTestEnvironmentFallback?: (fallback: TestEnvironmentModuleFallback) => void;
};

/**
 * Owns one worker process: state machine, birpc transport, task attribution.
 *
 * State machine: IDLE -> STARTING -> STARTED | START_FAILURE -> STOPPING -> STOPPED
 * Borrowed from Vitest, fix history baked in:
 *   - operation lock serializes start/stop
 *   - in-flight rpc rejects on unexpected exit
 *   - fatal_error attributes to currentTaskId
 *   - sends after STOPPING are silently dropped (vitest#9023)
 */
export class PoolRunner {
  readonly workerId: number;
  /** Environment identity this worker holds for life — see `Pool.acquireRunner`. */
  readonly environmentKey: string;
  readonly worker: PoolWorker;
  private state: RunnerState = 'IDLE';
  private operationChain: Promise<unknown> = Promise.resolve();
  private currentTask: PendingTask | undefined;
  private currentRpc: BirpcReturn<RuntimeRPC, ServerRPC> | undefined;
  private currentRpcDispatch:
    ((data: unknown, ...extras: unknown[]) => void) | undefined;
  private startDeferred: Deferred | undefined;
  private cleanupDeferred: Deferred | undefined;
  private stopDeferred: Deferred | undefined;
  private startTimer: NodeJS.Timeout | undefined;
  private cleanupTimer: NodeJS.Timeout | undefined;
  private fixtureCleanupTimer: NodeJS.Timeout | undefined;
  private workerCleanupCompleted = false;
  private lastFatalError: Error | undefined;
  /**
   * Set when the worker reports `fatal_error` or a transport error. The
   * runner is no longer safe to host another task even if `state` still
   * reads `STARTED` (the `exit` event arrives a tick later, and IPC may
   * already be half-closed). `isUsable()` checks this so the scheduler
   * never recycles a poisoned runner. See review for rstest#1142.
   */
  private crashed = false;
  private readonly onTestEnvironmentFallback?: (
    fallback: TestEnvironmentModuleFallback,
  ) => void;

  constructor(worker: PoolWorker, options: PoolRunnerOptions) {
    this.workerId = options.workerId;
    this.environmentKey = options.environmentKey;
    this.onTestEnvironmentFallback = options.onTestEnvironmentFallback;
    this.worker = worker;

    this.handleMessage = this.handleMessage.bind(this);
    this.handleExit = this.handleExit.bind(this);
    this.handleError = this.handleError.bind(this);

    worker.on('message', this.handleMessage);
    worker.on('exit', this.handleExit);
    worker.on('error', this.handleError);
  }

  isUsable(): boolean {
    return this.state === 'STARTED' && !this.crashed;
  }

  start(): Promise<void> {
    return this.runOperation(async () => {
      if (this.state === 'STARTED') return;
      if (this.state !== 'IDLE') {
        throw new Error(
          `PoolRunner.start: cannot start runner in state ${this.state}`,
        );
      }
      this.state = 'STARTING';

      // Install ack handlers and timeout BEFORE awaiting `worker.start()`.
      // Node can emit `exit` in the microtask between `worker.start()`
      // resolving and the handlers being installed (e.g. worker.js syntax
      // error → immediate child death). If `startDeferred` is unset at
      // that point, `handleExit` silently drops the exit and the later
      // `await` would hang for the full 90s timeout.
      this.startDeferred = createDeferred();
      // Swallow pre-await rejections to avoid unhandled-rejection noise.
      this.startDeferred.promise.catch(() => undefined);

      this.startTimer = setTimeout(
        () =>
          this.rejectStart(
            new Error(
              `Worker did not start within ${WORKER_START_TIMEOUT_MS}ms`,
            ),
          ),
        WORKER_START_TIMEOUT_MS,
      );
      this.startTimer.unref();

      try {
        await this.worker.start();
        this.worker.send({ type: 'start', workerId: this.workerId });
        await this.startDeferred.promise;
      } catch (err) {
        this.clearStartTimer();
        this.rejectStart(toError(err));
        // `handleExit` may have already transitioned the runner to STOPPED
        // during the await. Respect that so the dispose path short-circuits
        // instead of downgrading to START_FAILURE. The `as` cast is needed
        // because TS narrows `state` to 'STARTING' inside the try block and
        // can't see the async mutation.
        if ((this.state as RunnerState) !== 'STOPPED') {
          this.state = 'START_FAILURE';
        }
        throw toError(err);
      }

      this.state = 'STARTED';
    });
  }

  runTest(task: PoolTask): Promise<TestFileResult> {
    return this.runTaskInternal('run', task) as Promise<TestFileResult>;
  }

  collectTests(task: PoolTask): Promise<CollectTaskResult> {
    return this.runTaskInternal('collect', task) as Promise<CollectTaskResult>;
  }

  /**
   * Host owns termination — no IPC handshake. Per-task teardown runs in
   * `runInPool`'s own `finally` before `runFinished`, so by `stop()` there
   * is nothing process-level to drain. Relying on the worker's own
   * `process.exit()` was the rstest#1275 hang.
   */
  stop(options?: { force?: boolean }): Promise<void> {
    return this.runOperation(async () => {
      switch (this.state) {
        case 'STOPPED':
        case 'IDLE':
          return;
        case 'STOPPING': {
          // Wait for the in-flight stop to settle. If the caller asks for
          // `force` and the prior stop was graceful, escalate to SIGKILL —
          // the prior `await` may have resolved without actually killing
          // the child (e.g. SIGTERM masked).
          if (this.stopDeferred) {
            await this.stopDeferred.promise;
          }
          if (options?.force) {
            await this.worker.stop({ force: true });
          }
          return;
        }
      }

      // STARTING / STARTED / START_FAILURE.
      //
      // If the worker has no live child (fork threw, or child raced to
      // exit between STARTING and here), skipping the STOPPING path is
      // mandatory: no `close` event will ever fire, so the `stopDeferred`
      // below would hang forever and `Pool.close()`'s drain would deadlock.
      // We gate on `hasLiveChild()` instead of a state shortcut because
      // START_FAILURE can also mean "child exists but failed the start
      // handshake" (timeout, send error, handleError racing the ack), and
      // those must still be terminated.
      if (!this.worker.hasLiveChild()) {
        this.state = 'STOPPED';
        return;
      }

      let cleanupError: Error | undefined;
      if (
        !options?.force &&
        !this.currentTask &&
        !this.crashed &&
        !this.workerCleanupCompleted
      ) {
        try {
          await this.requestWorkerCleanup();
        } catch (error) {
          cleanupError = toError(error);
          this.crashed = true;
        }
      }
      if (!this.worker.hasLiveChild()) {
        this.state = 'STOPPED';
        if (cleanupError) throw cleanupError;
        return;
      }

      this.state = 'STOPPING';
      const stopDeferred = createDeferred();
      this.stopDeferred = stopDeferred;

      await this.worker.stop({ force: options?.force ?? false });
      await stopDeferred.promise;
      if (cleanupError) throw cleanupError;
    });
  }

  private requestWorkerCleanup(): Promise<void> {
    const deferred = createDeferred();
    this.cleanupDeferred = deferred;
    this.cleanupTimer = setTimeout(() => {
      this.rejectCleanup(
        new Error(
          `Worker fixture cleanup did not finish within ${FIXTURE_CLEANUP_TIMEOUT_MS}ms`,
        ),
      );
    }, FIXTURE_CLEANUP_TIMEOUT_MS);
    this.cleanupTimer.unref();
    try {
      this.worker.send({ type: 'cleanup' });
    } catch (error) {
      this.rejectCleanup(toError(error));
    }
    return deferred.promise;
  }

  async cleanupWorkerFixtures(): Promise<void> {
    if (
      this.currentTask ||
      this.workerCleanupCompleted ||
      this.crashed ||
      !this.worker.hasLiveChild()
    ) {
      return;
    }
    try {
      await this.requestWorkerCleanup();
    } catch (error) {
      this.crashed = true;
      throw error;
    }
  }

  private async runOperation<T>(op: () => Promise<T>): Promise<T> {
    const next = this.operationChain.then(op, op);
    this.operationChain = next.catch(() => undefined);
    return next;
  }

  private installRpc(rpcMethods: RuntimeRPC): void {
    this.disposeRpc();
    this.currentRpc = createBirpc<RuntimeRPC, ServerRPC>(rpcMethods, {
      // Worker RPC calls can legitimately run for a long time (snapshot
      // writes, asset transfers) — disable birpc's own timeout.
      timeout: -1,
      post: (data) => {
        this.worker.sendRaw(wrapRpc(data));
      },
      on: (fn) => {
        this.currentRpcDispatch = fn;
      },
    });
  }

  private disposeRpc(): void {
    if (this.currentRpc) {
      try {
        this.currentRpc.$close(
          new Error('[rstest-pool]: Pending methods while closing rpc'),
        );
      } catch {
        // ignore
      }
    }
    this.currentRpc = undefined;
    this.currentRpcDispatch = undefined;
  }

  private runTaskInternal(
    kind: TaskKind,
    task: PoolTask,
  ): Promise<TestFileResult | CollectTaskResult> {
    if (this.state !== 'STARTED') {
      return Promise.reject(
        new Error(
          `PoolRunner.${kind}: runner is not in STARTED state (current=${this.state})`,
        ),
      );
    }
    if (this.currentTask) {
      return Promise.reject(
        new Error(
          'PoolRunner: previous task is still in progress (concurrentTasksPerWorker=1)',
        ),
      );
    }

    this.installRpc(task.rpcMethods);
    // Per-task stderr attribution: discard buffered output from a prior
    // task on the same reused worker (`isolate: false`). Otherwise
    // `attachStderrToError` would mix the previous file's stderr into the
    // next file's failure message.
    this.worker.resetCapturedStderr();

    const taskId = ++nextTaskSeq;
    return new Promise<TestFileResult | CollectTaskResult>(
      (resolve, reject) => {
        this.currentTask = { kind, taskId, resolve, reject };

        try {
          this.worker.send({ type: kind, taskId, options: task.options });
        } catch (err) {
          this.currentTask = undefined;
          this.disposeRpc();
          reject(toError(err));
        }
      },
    ).finally(() => {
      this.disposeRpc();
    });
  }

  private handleMessage(message: unknown): void {
    if (isRpcEnvelope(message)) {
      this.currentRpcDispatch?.(message.payload);
      return;
    }
    if (isWorkerResponseEnvelope(message)) {
      this.handleResponse(message.response);
    }
    // Unknown messages are dropped — every legitimate envelope is tagged.
  }

  private handleResponse(response: WorkerResponse): void {
    switch (response.type) {
      case 'started':
        this.clearStartTimer();
        this.startDeferred?.resolve();
        this.startDeferred = undefined;
        return;
      case 'cleanupFinished':
        if (response.error) {
          this.rejectCleanup(deserializeError(response.error));
        } else {
          this.workerCleanupCompleted = true;
          this.resolveCleanup();
        }
        return;
      case 'fileCleanupStarted':
        if (this.currentTask?.taskId === response.taskId) {
          this.currentTask.provisionalResult = response.result;
        }
        this.startFixtureCleanupTimer(response.taskId);
        return;
      case 'fileCleanupFinished':
        if (this.currentTask?.taskId === response.taskId) {
          this.clearFixtureCleanupTimer();
        }
        return;
      case 'workerCleanupStarted':
        this.startFixtureCleanupTimer(response.taskId, 'Worker');
        return;
      case 'workerCleanupFinished':
        if (this.currentTask?.taskId === response.taskId) {
          this.clearFixtureCleanupTimer();
          if (response.error) {
            // `runInPool` reports cleanup before its final run result. Do not
            // reject the task here: that would discard the provisional result
            // (coverage, trace events, metadata, and test results) and force
            // `workerErrorToResult` to reconstruct a much smaller failure.
            // The worker appends this error to `runResult` before sending
            // `runFinished`; marking the runner crashed prevents reuse.
            this.crashed = true;
          }
        }
        return;
      case 'runFinished':
        this.resolveTask('run', response.taskId, response.result);
        return;
      case 'collectFinished':
        this.resolveTask('collect', response.taskId, response.result);
        return;
      case 'testEnvironmentFallback':
        this.onTestEnvironmentFallback?.(response.fallback);
        return;
      case 'fatal_error': {
        const error = deserializeError(response.error);
        // Mark as crashed BEFORE rejecting. The host's dispatch unwinds via
        // `releaseRunner` synchronously after the task promise settles, and
        // the worker's `exit` may not have arrived yet — without this
        // flag, `isUsable()` would still report true and the scheduler
        // would recycle a runner with corrupted internal state.
        this.crashed = true;
        this.rejectCurrentTaskWithStderr(error);
        // If fatal_error arrives without an active task, keep it so a
        // subsequent unexpected exit can surface it.
        this.lastFatalError = error;
        return;
      }
    }
  }

  private resolveTask(
    kind: TaskKind,
    taskId: number,
    result: TestFileResult | CollectTaskResult,
  ): void {
    const task = this.currentTask;
    if (!task || task.kind !== kind || task.taskId !== taskId) return;
    this.currentTask = undefined;
    this.clearFixtureCleanupTimer();
    task.resolve(result);
  }

  private handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.clearStartTimer();
    this.clearFixtureCleanupTimer();
    this.rejectCleanup(
      new Error(
        `Worker exited during fixture cleanup (code=${code}, signal=${signal})`,
      ),
    );

    const wasStopping = this.state === 'STOPPING';
    this.state = 'STOPPED';

    this.disposeRpc();

    this.rejectStart(
      new Error(
        `Worker exited before start ack (code=${code}, signal=${signal})`,
      ),
    );

    if (this.stopDeferred) {
      this.stopDeferred.resolve();
      this.stopDeferred = undefined;
    }

    // Reject any in-flight task regardless of whether the exit was planned.
    // Watch-mode restarts and signal-cleanup can stop a runner with a task
    // still mid-flight; dropping the rejection here would hang the
    // surrounding `Promise.all`.
    if (this.currentTask) {
      const error =
        this.lastFatalError ??
        new Error(
          wasStopping
            ? `Worker stopped before task completed (code=${code}, signal=${signal})`
            : `Worker exited unexpectedly (code=${code}, signal=${signal})`,
        );
      this.rejectCurrentTaskWithStderr(error);
    }
  }

  private handleError(err: Error): void {
    if (this.state === 'STOPPED' || this.state === 'STOPPING') return;
    // Non-benign transport/IPC error on a live runner means the channel is
    // compromised. Even if `child` has not emitted `close` yet, `sendRaw`
    // will silently drop future envelopes against `!connected`, and
    // `isolate: false` reuse would hand the next task a runner that never
    // responds — hanging the whole run. Mark as crashed so `isUsable()`
    // returns false and `Pool.releaseRunner` disposes instead of recycling.
    this.crashed = true;
    this.clearFixtureCleanupTimer();
    this.rejectCleanup(err);
    this.rejectStart(err);
    if (this.currentTask) {
      this.rejectCurrentTaskWithStderr(err);
    }
  }

  private rejectStart(err: Error): void {
    if (!this.startDeferred) return;
    const deferred = this.startDeferred;
    this.startDeferred = undefined;
    this.clearStartTimer();
    deferred.reject(err);
  }

  private rejectCurrentTaskWithStderr(err: Error): void {
    const task = this.currentTask;
    if (!task) return;
    this.currentTask = undefined;
    this.clearFixtureCleanupTimer();

    // Defer rejection briefly so pending stderr `data` events drain before
    // reading the buffer. The worker's `exit` event fires before stderr's
    // `close`; without this wait, crash output written right before exit
    // may be missed.
    void this.worker.waitForStderrSettle().then(() => {
      this.attachStderrToError(err);
      task.reject(err);
    });
  }

  private attachStderrToError(err: Error): void {
    const raw = this.worker.getCapturedStderr().trim();
    if (raw.length === 0) return;
    const stderr = formatCapturedStderr(raw);
    if (err.message.includes(stderr)) return;
    err.message = `${err.message}\n\nMaybe related stderr:\n${stderr}`;
  }

  private clearStartTimer(): void {
    if (!this.startTimer) return;
    clearTimeout(this.startTimer);
    this.startTimer = undefined;
  }

  private startFixtureCleanupTimer(
    taskId: number,
    scope: 'File' | 'Worker' = 'File',
  ): void {
    if (this.currentTask?.taskId !== taskId) {
      return;
    }
    this.clearFixtureCleanupTimer();
    this.fixtureCleanupTimer = setTimeout(() => {
      if (this.currentTask?.taskId !== taskId) {
        return;
      }
      this.crashed = true;
      const error = new Error(
        `${scope} fixture cleanup did not finish within ${FIXTURE_CLEANUP_TIMEOUT_MS}ms`,
      );
      const task = this.currentTask;
      if (task.kind === 'run' && task.provisionalResult) {
        this.currentTask = undefined;
        this.clearFixtureCleanupTimer();
        this.attachStderrToError(error);
        task.resolve(
          createFileCleanupTimeoutResult({
            message: error.message,
            projectName: task.provisionalResult.project,
            result: task.provisionalResult,
            testPath: task.provisionalResult.testPath,
          }),
        );
        return;
      }
      this.rejectCurrentTaskWithStderr(error);
    }, FIXTURE_CLEANUP_TIMEOUT_MS);
    this.fixtureCleanupTimer.unref();
  }

  private clearFixtureCleanupTimer(): void {
    if (!this.fixtureCleanupTimer) return;
    clearTimeout(this.fixtureCleanupTimer);
    this.fixtureCleanupTimer = undefined;
  }

  private resolveCleanup(): void {
    const deferred = this.cleanupDeferred;
    if (!deferred) return;
    this.cleanupDeferred = undefined;
    this.clearCleanupTimer();
    deferred.resolve();
  }

  private rejectCleanup(error: Error): void {
    const deferred = this.cleanupDeferred;
    if (!deferred) return;
    this.cleanupDeferred = undefined;
    this.clearCleanupTimer();
    deferred.reject(error);
  }

  private clearCleanupTimer(): void {
    if (!this.cleanupTimer) return;
    clearTimeout(this.cleanupTimer);
    this.cleanupTimer = undefined;
  }
}
