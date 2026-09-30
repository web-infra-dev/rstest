import type { TestFileResult } from '../types';
import { PoolRunner, WorkerOomKillError } from './poolRunner';
import type {
  CollectTaskResult,
  TestEnvironmentModuleFallback,
} from './protocol';
import type { PoolOptions, PoolTask } from './types';
import { createPoolWorker } from './workers';

/** Attempts per file when fork workers are killed by SIGKILL; the last runs alone. */
export const MAX_OOM_ATTEMPTS = 3;

/**
 * Deliberately minimal scheduler — matches the prior tinypool behavior:
 *   - one task per worker at a time (concurrentTasksPerWorker=1)
 *   - parallel dispatch up to maxWorkers, slot-waiter blocks excess callers
 *   - isolate=true: fresh runner per task, stopped in the background
 *   - isolate=false: idle runners reused (environment-matched), lazy-spawned
 */
export class Pool {
  private readonly options: PoolOptions;
  private readonly idleRunners: PoolRunner[] = [];
  private readonly activeRunners = new Set<PoolRunner>();
  /**
   * Runners that have left `activeRunners` but whose child process has not
   * fully exited yet. They still occupy a slot for capacity accounting (so
   * `isolate: true` cannot transiently exceed `maxWorkers`) and `close()`
   * waits for their stop promises to settle.
   */
  private readonly stoppingRunners = new Set<PoolRunner>();
  private readonly stoppingPromises = new Set<Promise<void>>();
  private readonly workerStopErrors: Error[] = [];
  private readonly slotWaiters: Array<{
    task: PoolTask;
    exclusive: boolean;
    resolve: (runner: PoolRunner) => void;
    reject: (error: Error) => void;
  }> = [];
  private ceiling: number;
  private epoch = 0;
  // A kill halves the ceiling only if its runner was claimed in the current
  // epoch; reused runners carry the epoch of their latest claim.
  private readonly claimEpochs = new WeakMap<PoolRunner, number>();
  private successes = 0;
  private exclusiveRunner: PoolRunner | undefined;
  /**
   * Set of currently-assigned worker ids. Mirrors Jest's `JEST_WORKER_ID`
   * and rstest 0.9.x's tinypool-backed semantics: ids are bounded by
   * `[1, maxWorkers]` and reused after the previous worker fully exits, so
   * consumers can use `RSTEST_WORKER_ID` to partition finite resources
   * (e.g. database names). See rstest#1273 for the regression that
   * motivated restoring this.
   */
  private readonly slotInUse = new Set<number>();
  private readonly reportedEnvironmentFallbacks = new Set<string>();
  private isClosing = false;
  private isClosed = false;

  get closing(): boolean {
    return this.isClosing;
  }

  constructor(options: PoolOptions) {
    this.options = options;
    this.ceiling = options.maxWorkers;
  }

  private readonly handleTestEnvironmentFallback = (
    fallback: TestEnvironmentModuleFallback,
  ): void => {
    const key = `${fallback.bundlePath}\0${fallback.resolvedPath}`;
    if (this.reportedEnvironmentFallbacks.has(key)) {
      return;
    }
    this.reportedEnvironmentFallbacks.add(key);
    this.options.onTestEnvironmentFallback?.(fallback);
  };

  async runTest(task: PoolTask): Promise<TestFileResult> {
    return this.dispatch(task, 'run') as Promise<TestFileResult>;
  }

  async cleanupWorkerFixtures(): Promise<Error[]> {
    if (this.options.isolate) {
      return [];
    }

    // A reusable runner can already be stopping when the idle floor sheds an
    // environment-mismatched worker. Its stop path owns worker fixture
    // cleanup, so drain those promises before finalizing the run and preserve
    // any errors they reported.
    const errors = await this.drainWorkerStopErrors();
    const idleErrors = await Promise.all(
      this.idleRunners.map(async (runner) => {
        try {
          await runner.cleanupWorkerFixtures();
          return undefined;
        } catch (error) {
          return error instanceof Error ? error : new Error(String(error));
        }
      }),
    );
    errors.push(
      ...idleErrors.filter((error): error is Error => error !== undefined),
    );
    return errors;
  }

  async drainWorkerStopErrors(): Promise<Error[]> {
    await Promise.all([...this.stoppingPromises]);
    return this.workerStopErrors.splice(0);
  }

  async collectTests(task: PoolTask): Promise<CollectTaskResult> {
    return this.dispatch(task, 'collect') as Promise<CollectTaskResult>;
  }

  private async dispatch(
    task: PoolTask,
    op: 'run' | 'collect',
  ): Promise<TestFileResult | CollectTaskResult> {
    if (this.isClosing || this.isClosed) {
      throw new Error('[rstest-pool]: pool is closed');
    }

    let pendingRunner = this.acquireRunner(task, 1);
    for (let attempt = 1; ; attempt++) {
      let runner: PoolRunner | undefined;
      let started = false;
      try {
        runner = await pendingRunner;
        await runner.start();
        started = true;
        let assets = await task.loadAssets?.();
        const pendingResult = runner[op === 'run' ? 'runTest' : 'collectTests'](
          {
            ...task,
            options: { ...task.options, assets: assets ?? task.options.assets },
          },
        );
        // IPC has taken ownership; the pending attempt must not retain bytes.
        assets = undefined;
        const result = await pendingResult;
        if (++this.successes >= this.ceiling) {
          this.ceiling = Math.min(this.options.maxWorkers, this.ceiling + 1);
          this.successes = 0;
        }
        return result;
      } catch (error) {
        if (!(error instanceof WorkerOomKillError) || this.isClosing)
          throw error;
        if (attempt === MAX_OOM_ATTEMPTS) {
          throw new WorkerOomKillError(
            `Worker killed by SIGKILL even when running alone after ${MAX_OOM_ATTEMPTS} attempts (likely out of memory)`,
          );
        }
        task.onRetry?.(attempt, this.ceiling);
        // Reserve the retry's place before releasing the killed runner's slot.
        pendingRunner = this.acquireRunner(task, attempt + 1);
      } finally {
        if (runner) this.releaseRunner(runner, !started);
      }
    }
  }

  /**
   * Ordering invariant: a caller's slot is claimed synchronously — the waiter
   * is queued and `wakeWaiters` runs inside the Promise executor below. The
   * sequential dispatch gate in `pool/index.ts` relies on this to preserve
   * perf-sorted enqueue order; do not introduce an `await` before the waiter
   * is queued without revisiting it.
   */
  private acquireRunner(task: PoolTask, attempt: number): Promise<PoolRunner> {
    return new Promise((resolve, reject) => {
      const waiter = {
        task,
        exclusive: attempt === MAX_OOM_ATTEMPTS,
        resolve,
        reject,
      };
      if (attempt > 1) this.slotWaiters.unshift(waiter);
      else this.slotWaiters.push(waiter);
      this.wakeWaiters();
    });
  }

  private wakeWaiters(): void {
    while (this.slotWaiters.length > 0 && !this.isClosing && !this.isClosed) {
      const waiter = this.slotWaiters[0]!;
      const { task, exclusive } = waiter;
      const { environmentKey } = task.options;
      const fork = task.worker === 'forks' || task.worker === 'vmForks';
      // Idle workers keep their heaps; the exclusive attempt waits for them to
      // exit like any stopping worker.
      if (exclusive) {
        for (const idle of this.idleRunners.splice(0)) {
          this.disposeRunnerInBackground(idle);
        }
      }
      if (
        this.exclusiveRunner ||
        (exclusive &&
          this.activeRunners.size + this.stoppingRunners.size > 0) ||
        this.activeRunners.size >= this.ceiling
      )
        return;

      // Prefer reuse of an idle runner (only meaningful when isolate=false,
      // since isolate=true never returns runners to the idle pool). Most
      // recently returned first (LIFO) — hottest kept module cache — and
      // restricted to runners already holding this task's environment, so a
      // reused worker never has to swap environments mid-life.
      const reuseIndex = this.idleRunners.findLastIndex(
        (idle) => idle.environmentKey === environmentKey,
      );
      if (reuseIndex !== -1) {
        const reuse = this.idleRunners.splice(reuseIndex, 1)[0]!;
        if (reuse.isUsable()) {
          this.claimEpochs.set(reuse, this.epoch);
          this.activeRunners.add(reuse);
          if (exclusive) this.exclusiveRunner = reuse;
          this.slotWaiters.shift();
          waiter.resolve(reuse);
          continue;
        }
        // Stale — dispose in the background so its slot is reclaimed only
        // after the child has actually exited.
        this.disposeRunnerInBackground(reuse);
        continue;
      }

      if (this.inFlightCount >= this.options.maxWorkers) {
        // No idle runner holds this environment. Idle runners still occupy
        // slots, so shed the coldest one rather than parking behind workers
        // that can never serve this task; its slot — and this waiter — is
        // released once the child exits.
        if (this.idleRunners.length > 0) {
          this.disposeRunnerInBackground(this.idleRunners.shift()!);
        }
        return;
      }

      // Reserve capacity before startup; dispatch owns release even when the
      // child dies before its start acknowledgement.
      const workerId = this.acquireWorkerId();
      const worker = createPoolWorker(task, this.options, workerId);
      const runner = new PoolRunner(worker, {
        workerId,
        environmentKey,
        memoryLimit: this.options.memoryLimit,
        memoryMetric: task.worker === 'forks' ? 'rss' : 'heapUsed',
        onTestEnvironmentFallback: this.handleTestEnvironmentFallback,
        onOomKill: fork
          ? () => {
              if (
                !this.isClosing &&
                this.claimEpochs.get(runner) === this.epoch
              ) {
                const liveCount = [...this.activeRunners].filter(
                  (active) => active === runner || active.worker.hasLiveChild(),
                ).length;
                this.ceiling = Math.max(1, Math.floor(liveCount / 2));
                this.successes = 0;
                this.epoch++;
              }
            }
          : undefined,
      });
      this.claimEpochs.set(runner, this.epoch);
      this.activeRunners.add(runner);
      if (exclusive) this.exclusiveRunner = runner;
      this.slotWaiters.shift();
      // Queue start before close can queue stop. Dispatch observes the same
      // promise and retains the runner on startup failure for ordered retry.
      void runner.start().catch(() => undefined);
      waiter.resolve(runner);
    }
  }

  private get inFlightCount(): number {
    return (
      this.activeRunners.size +
      this.idleRunners.length +
      this.stoppingRunners.size
    );
  }

  /**
   * Allocates the lowest free id in `[1, maxWorkers]`. Capacity is
   * guaranteed by the `slotWaiters` gate (callers park until
   * `inFlightCount < maxWorkers`), so the loop always finds a slot —
   * the throw guards against a future regression in slot accounting.
   */
  private acquireWorkerId(): number {
    for (let i = 1; i <= this.options.maxWorkers; i++) {
      if (!this.slotInUse.has(i)) {
        this.slotInUse.add(i);
        return i;
      }
    }
    throw new Error('[rstest-pool]: no free worker id');
  }

  private releaseWorkerId(id: number): void {
    this.slotInUse.delete(id);
  }

  private releaseRunner(runner: PoolRunner, force = false): void {
    this.activeRunners.delete(runner);
    if (this.exclusiveRunner === runner) this.exclusiveRunner = undefined;

    // `isolate: true`, closing, or unusable — never reuse.
    if (
      this.options.isolate !== false ||
      this.isClosing ||
      this.isClosed ||
      force ||
      !runner.isUsable() ||
      runner.shouldRecycle()
    ) {
      // Background dispose. The slot stays accounted for in `stoppingRunners`
      // until the child actually exits, so `isolate: true` cannot transiently
      // exceed `maxWorkers` and `close()` can drain in-flight stops.
      this.disposeRunnerInBackground(runner, { force });
      return;
    }

    // `isolate: false` reuse path.
    //
    // `minWorkers` is a *floor for retained idle runners after demand drops*,
    // not a cap on reuse. Two cases keep this runner alive:
    //   1) There is a pending caller in `slotWaiters` — somebody needs a
    //      slot right now, so reuse instead of paying another fork/startup
    //      round-trip. Without this branch a long queue with `maxWorkers >
    //      minWorkers` would degenerate into per-task spawn/exit cycles.
    //   2) There is no waiter, but the idle pool has not yet reached
    //      `minWorkers` — keep the runner around as steady-state capacity.
    // Otherwise the idle pool is already at the floor, so shed this runner.
    //
    // The floor is counted per environment, because reuse is environment-
    // matched: idle runners holding a different environment can never serve
    // this one, so counting them would let a cold environment's leftovers
    // squat the floor and force this environment to respawn every task.
    const minWorkers = Math.max(this.options.minWorkers, 0);
    const hasWaiter = this.slotWaiters.length > 0;
    const idleForEnvironment = this.idleRunners.filter(
      (idle) => idle.environmentKey === runner.environmentKey,
    ).length;

    if (hasWaiter || idleForEnvironment < minWorkers) {
      this.idleRunners.push(runner);
      if (hasWaiter) {
        // Idle slot is immediately consumable — wake one waiter now.
        this.wakeWaiters();
      }
      return;
    }

    this.disposeRunnerInBackground(runner);
  }

  /**
   * Stop a runner outside the calling task's critical path. The runner is
   * tracked in `stoppingRunners` until the child exits — only then is the
   * slot considered free and a waiter woken.
   */
  private disposeRunnerInBackground(
    runner: PoolRunner,
    options?: { force?: boolean },
  ): void {
    this.stoppingRunners.add(runner);
    const stopPromise: Promise<void> = runner
      .stop(options)
      .catch((error: unknown) => {
        this.workerStopErrors.push(
          error instanceof Error ? error : new Error(String(error)),
        );
      })
      .finally(() => {
        this.stoppingRunners.delete(runner);
        this.stoppingPromises.delete(stopPromise);
        this.releaseWorkerId(runner.workerId);
        // Slot is now truly free — wake one waiter (unless we're closing,
        // in which case waiters were already drained).
        if (!this.isClosed) {
          this.wakeWaiters();
        }
      });
    this.stoppingPromises.add(stopPromise);
  }

  /**
   * Terminal, one-way latch: closing never resets. Parked acquireRunner
   * callers are rejected instead of waiting through teardown.
   */
  interrupt(): void {
    this.isClosing = true;
    while (this.slotWaiters.length > 0) {
      this.slotWaiters
        .shift()!
        .reject(new Error('[rstest-pool]: pool is closed'));
    }
  }

  async close(): Promise<void> {
    if (this.isClosed) return;
    this.interrupt();
    const runners = [...this.activeRunners, ...this.idleRunners];
    await Promise.all(
      runners.map((runner) =>
        runner.stop().catch((error: unknown) => {
          this.workerStopErrors.push(
            error instanceof Error ? error : new Error(String(error)),
          );
        }),
      ),
    );
    // Drain background-stopping runners — `isolate: true` releases hand
    // children off here, and `close()` must not return until they are gone.
    await Promise.all([...this.stoppingPromises]);
    this.idleRunners.length = 0;
    this.activeRunners.clear();
    this.isClosed = true;
    const errors = this.workerStopErrors.splice(0);
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, 'Failed to stop test workers.');
    }
  }
}
