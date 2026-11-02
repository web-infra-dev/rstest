import type {
  AfterEachListener,
  BeforeAllListener,
  BeforeEachListener,
  RuntimeConfig,
  TestCase,
  TestContext,
  TestSuite,
} from '../../types';
import type { FixtureResolver } from './fixtures';
import { inheritTimeout, limitConcurrency, runWithTimeout } from './task';

export type ParentHooks = {
  beforeEachListeners: BeforeEachListener[][];
  afterEachListeners: AfterEachListener[][];
};

type PerTestHookResult =
  | { status: 'completed'; cleanup?: void | AfterEachListener }
  | { status: 'skipped' }
  | {
      status: 'failed';
      phase: 'fixture' | 'callback';
      error: unknown;
    };

export class HookRunner {
  private readonly limitHooks: ReturnType<typeof limitConcurrency>;

  constructor(
    private readonly config: Pick<RuntimeConfig, 'sequence' | 'maxConcurrency'>,
    private readonly runWithActiveTimeout: <T>(
      test: TestCase | TestSuite,
      fn: BeforeEachListener | BeforeAllListener,
      callback: () => T | Promise<T>,
    ) => Promise<T>,
    private readonly abortContextSignal: (
      context: TestContext,
      error: Error,
    ) => void,
  ) {
    this.limitHooks = limitConcurrency(config.maxConcurrency);
  }

  runWithTimeoutContext<T>(
    test: TestCase | TestSuite,
    fn: BeforeEachListener | BeforeAllListener,
    callback: () => T | Promise<T>,
  ): T | Promise<T> {
    // Parallel hooks share a task, so a task-level deadline would belong to
    // whichever hook started last. Keep each hook's own timeout wrapper and
    // let polling assertions use their configured timeout in this mode.
    return this.config.sequence.hooks === 'parallel'
      ? callback()
      : this.runWithActiveTimeout(test, fn, callback);
  }

  async runGroup<T>(
    listeners: T[],
    run: (listener: T) => Promise<boolean | void>,
  ): Promise<boolean> {
    if (this.config.sequence.hooks === 'parallel') {
      const results = await Promise.all(
        listeners.map((listener) => this.limitHooks(() => run(listener))),
      );
      return results.every((result) => result !== false);
    }
    for (const listener of listeners) {
      if ((await run(listener)) === false) {
        return false;
      }
    }
    return true;
  }

  async runPerTestGroup(
    listeners: (BeforeEachListener | AfterEachListener)[],
    test: TestCase,
    fixtureResolver: FixtureResolver,
    fixtureCleanups: (() => Promise<void>)[],
    onResult: (
      result: PerTestHookResult,
      listener: BeforeEachListener | AfterEachListener,
    ) => Promise<boolean | void>,
  ): Promise<boolean> {
    const cancellations: (() => void)[] = [];
    const cancel = (cancellation: () => void) => {
      if (this.config.sequence.hooks === 'parallel') {
        cancellations.push(cancellation);
      } else {
        cancellation();
      }
    };
    try {
      return await this.runGroup(listeners, async (fn) => {
        const result = await this.runPerTestHook(
          test,
          fn,
          fixtureResolver,
          fixtureCleanups,
          cancel,
        );
        return onResult(result, fn);
      });
    } finally {
      // The resolver is shared by sibling hooks. Cancel pending setup only
      // after every parallel hook has had a chance to finish using it.
      for (const cancellation of cancellations) cancellation();
    }
  }

  private async runPerTestHook(
    test: TestCase,
    fn: BeforeEachListener | AfterEachListener,
    fixtureResolver: FixtureResolver,
    fixtureCleanups: (() => Promise<void>)[],
    cancel: (cancellation: () => void) => void,
  ): Promise<PerTestHookResult> {
    let callbackStarted = false;
    let hookFailed = false;
    const runHook = async (
      callback: BeforeEachListener | AfterEachListener,
    ) => {
      const resolution = await fixtureResolver.resolveHookFixtures(callback);
      if (hookFailed || resolution.status === 'skipped') {
        return { status: 'skipped' as const };
      }
      callbackStarted = true;
      const cleanup = await callback(test.context);
      return { status: 'completed' as const, cleanup };
    };
    let hookExecution: ReturnType<typeof runHook> | undefined;
    try {
      return await this.runWithTimeoutContext(test, fn, () =>
        runWithTimeout(
          fn,
          (callback) => {
            hookExecution = runHook(callback);
            return hookExecution;
          },
          (error) => this.abortContextSignal(test.context, error),
        ),
      );
    } catch (error) {
      hookFailed = true;
      if (!callbackStarted) {
        cancel(() => {
          const cancellation = fixtureResolver.cancelPendingFixtures();
          if (cancellation && hookExecution) {
            const hookCompletion = hookExecution.then(
              () => ({ status: 'completed' as const }),
              (fixtureError: unknown) => ({
                status: 'failed' as const,
                error: fixtureError,
              }),
            );
            const cancellationProgress = Promise.race([
              hookCompletion.then((completion) => ({
                status: 'completed' as const,
                completion,
              })),
              cancellation.teardownStarted.then(() => ({
                status: 'teardown-started' as const,
              })),
            ]);
            const waitForCancellationProgress = inheritTimeout(
              fn,
              () => cancellationProgress,
            );
            fixtureCleanups.unshift(async () => {
              let progress: Awaited<typeof cancellationProgress>;
              try {
                progress = await waitForCancellationProgress();
              } catch {
                // The original hook timeout is already reported. This timeout
                // only bounds how long unfinished setup may delay the test.
                return;
              }
              // Once `use` is reached, match normal fixture cleanup semantics:
              // teardown must finish before the runner continues.
              const completion =
                progress.status === 'teardown-started'
                  ? await hookCompletion
                  : progress.completion;
              if (completion.status === 'failed') {
                throw completion.error;
              }
            });
          }
        });
      }
      return {
        status: 'failed',
        phase: callbackStarted ? 'callback' : 'fixture',
        error,
      };
    }
  }
}
