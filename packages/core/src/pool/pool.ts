import type { TestFileResult } from '../types';
import { PoolRunner } from './poolRunner';
import type { CollectTaskResult } from './protocol';
import type { PoolOptions, PoolTask } from './types';
import { createPoolWorker } from './workers';

let nextWorkerId = 0;

/**
 * Phase 1 scheduler. Deliberately minimal — matches the prior tinypool
 * behavior:
 *   - one task per worker at a time (concurrentTasksPerWorker=1)
 *   - parallel dispatch up to maxWorkers, slot-waiter blocks excess callers
 *   - isolate=true: fresh runner per task, stopped in the background
 *   - isolate=false: idle runners reused, lazy-spawned on demand
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
  private readonly slotWaiters: Array<() => void> = [];
  private isClosing = false;
  private isClosed = false;

  constructor(options: PoolOptions) {
    this.options = options;
  }

  async runTest(task: PoolTask): Promise<TestFileResult> {
    return this.dispatch(task, 'run') as Promise<TestFileResult>;
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

    const runner = await this.acquireRunner(task);
    try {
      if (op === 'run') {
        return await runner.runTest(task);
      }
      return await runner.collectTests(task);
    } finally {
      this.releaseRunner(runner);
    }
  }

  private async acquireRunner(task: PoolTask): Promise<PoolRunner> {
    while (true) {
      // Prefer reuse of an idle runner (only meaningful when isolate=false,
      // since isolate=true never returns runners to the idle pool).
      const reuse = this.idleRunners.pop();
      if (reuse) {
        if (reuse.isUsable()) {
          this.activeRunners.add(reuse);
          return reuse;
        }
        // Stale — dispose in the background so its slot is reclaimed only
        // after the child has actually exited.
        this.disposeRunnerInBackground(reuse);
        continue;
      }

      const inFlight =
        this.activeRunners.size +
        this.idleRunners.length +
        this.stoppingRunners.size;
      if (inFlight >= this.options.maxWorkers) {
        await new Promise<void>((resolve) => {
          this.slotWaiters.push(resolve);
        });
        if (this.isClosing || this.isClosed) {
          throw new Error('[rstest-pool]: pool is closed');
        }
        continue;
      }

      // Spawn a fresh runner. We claim the slot by inserting the runner into
      // activeRunners up-front; on start failure we drop it and wake a waiter.
      const workerId = ++nextWorkerId;
      const worker = createPoolWorker(task, this.options, workerId);
      const runner = new PoolRunner(worker, { workerId });
      this.activeRunners.add(runner);
      try {
        await runner.start();
      } catch (err) {
        this.activeRunners.delete(runner);
        // Force-dispose the failed runner; the slot is freed only when the
        // child is actually gone, so capacity accounting stays honest.
        this.disposeRunnerInBackground(runner, { force: true });
        throw err;
      }
      return runner;
    }
  }

  private releaseRunner(runner: PoolRunner): void {
    this.activeRunners.delete(runner);

    // `isolate: true`, closing, or unusable — never reuse.
    if (
      this.options.isolate !== false ||
      this.isClosing ||
      this.isClosed ||
      !runner.isUsable()
    ) {
      // Background dispose. The slot stays accounted for in `stoppingRunners`
      // until the child actually exits, so `isolate: true` cannot transiently
      // exceed `maxWorkers` and `close()` can drain in-flight stops.
      this.disposeRunnerInBackground(runner);
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
    const minWorkers = Math.max(this.options.minWorkers, 0);
    const hasWaiter = this.slotWaiters.length > 0;

    if (hasWaiter || this.idleRunners.length < minWorkers) {
      this.idleRunners.push(runner);
      if (hasWaiter) {
        // Idle slot is immediately consumable — wake one waiter now.
        this.slotWaiters.shift()?.();
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
      .catch(() => undefined)
      .finally(() => {
        this.stoppingRunners.delete(runner);
        this.stoppingPromises.delete(stopPromise);
        // Slot is now truly free — wake one waiter (unless we're closing,
        // in which case waiters were already drained).
        if (!this.isClosed) {
          this.slotWaiters.shift()?.();
        }
      });
    this.stoppingPromises.add(stopPromise);
  }

  async close(): Promise<void> {
    if (this.isClosed) return;
    this.isClosing = true;
    // Wake waiters so any caller blocked on capacity throws on `isClosing`
    // before we await the stop promises below.
    while (this.slotWaiters.length > 0) {
      this.slotWaiters.shift()?.();
    }
    const runners = [...this.activeRunners, ...this.idleRunners];
    await Promise.all(runners.map((r) => r.stop().catch(() => undefined)));
    // Drain background-stopping runners — `isolate: true` releases hand
    // children off here, and `close()` must not return until they are gone.
    await Promise.all([...this.stoppingPromises]);
    this.idleRunners.length = 0;
    this.activeRunners.clear();
    this.isClosed = true;
  }
}
