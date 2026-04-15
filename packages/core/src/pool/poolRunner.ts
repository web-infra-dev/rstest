import { type BirpcReturn, createBirpc } from 'birpc';
import type { RuntimeRPC, ServerRPC, TestFileResult } from '../types';
import type { PoolWorker } from './poolWorker';
import {
  type CollectTaskResult,
  deserializeError,
  isRpcEnvelope,
  isWorkerResponseEnvelope,
  type WorkerResponse,
  wrapRpc,
} from './protocol';
import type { PoolTask } from './types';

const WORKER_START_TIMEOUT_MS = 90_000;
const WORKER_STOP_TIMEOUT_MS = 60_000;

type RunnerState =
  | 'IDLE'
  | 'STARTING'
  | 'STARTED'
  | 'START_FAILURE'
  | 'STOPPING'
  | 'STOPPED';

type TaskKind = 'run' | 'collect';

type PendingTask = {
  kind: TaskKind;
  taskId: number;
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

const toError = (err: unknown): Error =>
  err instanceof Error ? err : new Error(String(err));

let nextTaskSeq = 0;

type PoolRunnerOptions = {
  workerId: number;
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
  readonly worker: PoolWorker;
  private state: RunnerState = 'IDLE';
  private operationChain: Promise<unknown> = Promise.resolve();
  private currentTask: PendingTask | undefined;
  private currentRpc: BirpcReturn<RuntimeRPC, ServerRPC> | undefined;
  private currentRpcDispatch:
    | ((data: unknown, ...extras: unknown[]) => void)
    | undefined;
  private startDeferred: Deferred | undefined;
  private stopDeferred: Deferred | undefined;
  private startTimer: NodeJS.Timeout | undefined;
  private stopTimer: NodeJS.Timeout | undefined;
  private lastFatalError: Error | undefined;
  /**
   * Set when the worker reports `fatal_error` or a transport error. The
   * runner is no longer safe to host another task even if `state` still
   * reads `STARTED` (the `exit` event arrives a tick later, and IPC may
   * already be half-closed). `isUsable()` checks this so the scheduler
   * never recycles a poisoned runner. See review for rstest#1142.
   */
  private crashed = false;

  constructor(worker: PoolWorker, options: PoolRunnerOptions) {
    this.workerId = options.workerId;
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

  stop(options?: { force?: boolean }): Promise<void> {
    return this.runOperation(async () => {
      switch (this.state) {
        case 'STOPPED':
        case 'IDLE':
          return;
        case 'STOPPING': {
          // Wait for the in-flight stop, then optionally force.
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

      this.state = 'STOPPING';
      this.stopDeferred = createDeferred();

      // Best-effort graceful stop. The worker defers its own exit until
      // after any in-flight task completes teardown; SIGTERM (sent by the
      // worker implementation) is the nudge that kicks the handler in.
      try {
        this.worker.send({ type: 'stop' });
      } catch {
        // ignore: worker may already be down
      }

      // Escalate to SIGKILL if graceful teardown exceeds the budget.
      this.stopTimer = setTimeout(() => {
        void this.worker.stop({ force: true }).catch(() => undefined);
      }, WORKER_STOP_TIMEOUT_MS);
      this.stopTimer.unref();

      await this.worker.stop({ force: options?.force === true });
      await this.stopDeferred.promise;
    });
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
      case 'runFinished':
        this.resolveTask('run', response.taskId, response.result);
        return;
      case 'collectFinished':
        this.resolveTask('collect', response.taskId, response.result);
        return;
      case 'stopped':
        // Worker acknowledged graceful shutdown — actual transition happens
        // in `handleExit`.
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
    task.resolve(result);
  }

  private handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.clearStopTimer();
    this.clearStartTimer();

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
    this.attachStderrToError(err);
    task.reject(err);
  }

  private attachStderrToError(err: Error): void {
    const stderr = this.worker.getCapturedStderr().trim();
    if (stderr.length === 0) return;
    if (err.message.includes(stderr)) return;
    err.message = `${err.message}\n\nMaybe related stderr:\n${stderr}`;
  }

  private clearStartTimer(): void {
    if (!this.startTimer) return;
    clearTimeout(this.startTimer);
    this.startTimer = undefined;
  }

  private clearStopTimer(): void {
    if (!this.stopTimer) return;
    clearTimeout(this.stopTimer);
    this.stopTimer = undefined;
  }
}
