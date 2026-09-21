import type {
  InternalContext,
  InternalProjectContext,
  MaybePromise,
  Reporter,
  RawTestCaseInfo,
  RawTestFileInfo,
  RawTestFileResult,
  RawTestInfo,
  RawTestResult,
  RawTestSuiteInfo,
  RawUserConsoleLog,
  RuntimeRPC,
  TestFileInfo,
  TestFileResult,
  TestInfo,
  TestResult,
  UserConsoleLog,
} from '../types';
import { relative } from 'pathe';
import { reporterFileKey } from '../reporter/utils';
import { color, getTaskNameWithPrefix, logger, toError } from '../utils';
import { getFileSummary } from '../utils/testSummary';
import { resolveSnapshotPathDefault } from '../utils/snapshotPath';

type PendingReporterHooks = {
  files: Map<string, Set<Promise<void>>>;
  errors: Error[];
};

const pendingHooks = new WeakMap<InternalContext, PendingReporterHooks>();

const joinHooks = async (pending: Set<Promise<void>>): Promise<void> => {
  while (pending.size) {
    await Promise.all(pending);
  }
};

export async function drainReporterHooks(
  context: InternalContext,
): Promise<Error[]> {
  const pending = pendingHooks.get(context);
  if (!pending) {
    return [];
  }
  for (;;) {
    const all = [...pending.files.values()].flatMap((file) => [...file]);
    if (!all.length) break;
    await Promise.all(all);
  }
  pending.files.clear();
  return pending.errors.splice(0);
}

/**
 * The single event pump for runner lifecycle events, shared by the node pool
 * RPC and the browser dispatch runner namespace. One implementation feeds
 * `stateManager`, fans out to reporters,
 * applies the per-project `onConsoleLog` filter, ingests snapshot results, and
 * resolves snapshot paths — so the two transports can no longer drift.
 *
 * Per-project binding is constructor-time: a sink instance is bound to one
 * project's `normalizedConfig`, making the `onConsoleLog` / `resolveSnapshotPath`
 * root-config drift impossible by construction.
 */
/**
 * Sink members the host drives directly — never carried over the wire
 * {@link RuntimeRPC}. Declared apart so the drift guard below derives its
 * exclusions from the classification instead of a hand-kept name list.
 */
interface HostDrivenEvents {
  /**
   * AWAITED by both transports, and ingests `result.snapshotResult`. The pool
   * calls it after `pool.runTest` returns, the browser host after a client
   * file completes.
   */
  onTestFileResult(result: RawTestFileResult): Promise<TestFileResult>;
  /**
   * Reporter fanout without the filter, for output already filtered once — the
   * merge-reports replay, whose logs only reached the blob because the
   * recording run's filter admitted them. Re-filtering there could drop output
   * the recorded run kept, and honoring `disableConsoleIntercept` here would
   * let a merge-side config silently swallow logs the recording run captured.
   * Carries no project-scoped behavior, so any project's sink will do.
   */
  emitConsoleLog(log: RawUserConsoleLog): Promise<void>;
  /** Emits a synthesized case result without recording it in state. */
  emitTestCaseResult(result: RawTestResult): Promise<TestResult>;
}

export interface RunnerEventSink extends HostDrivenEvents {
  onTestCaseStart(test: RawTestCaseInfo): Promise<void>;
  onTestFileStart(test: RawTestFileInfo): Promise<void>;
  onTestFileReady(test: RawTestFileInfo): Promise<void>;
  onTestSuiteStart(test: RawTestSuiteInfo): Promise<void>;
  onTestSuiteResult(result: RawTestResult): Promise<void>;
  onTestCaseResult(result: RawTestResult): Promise<TestResult>;
  /** Applies the owning project's `onConsoleLog` filter before reporter fanout. */
  onConsoleLog(log: RawUserConsoleLog): Promise<void>;
  getCountOfFailedTests(): number;
  /** Resolves via the owning project's `resolveSnapshotPath` (per-project). */
  resolveSnapshotPath(testPath: string): string;
}

export function createRunnerEventSink(
  context: InternalContext,
  projectConfig: InternalProjectContext['normalizedConfig'],
): RunnerEventSink {
  const { reporters } = context;
  let pending = pendingHooks.get(context);
  if (!pending) {
    pending = { files: new Map(), errors: [] };
    pendingHooks.set(context, pending);
  }
  const run = pending;

  const enrichTask = <T extends RawTestCaseInfo | RawTestSuiteInfo>(
    task: T,
  ): T & { fullName: string; relativeTestPath: string } => ({
    ...task,
    fullName: getTaskNameWithPrefix(task),
    relativeTestPath: relative(context.rootPath, task.testPath),
  });
  const enrichInfo = (test: RawTestInfo): TestInfo =>
    test.type === 'suite'
      ? { ...enrichTask(test), tests: test.tests.map(enrichInfo) }
      : enrichTask(test);
  const enrichFileInfo = (test: RawTestFileInfo): TestFileInfo => ({
    ...test,
    relativeTestPath: relative(context.rootPath, test.testPath),
    tests: test.tests.map(enrichInfo),
  });
  const enrichResult = (result: RawTestResult): TestResult => ({
    ...result,
    fullName: getTaskNameWithPrefix(result),
    relativeTestPath: relative(context.rootPath, result.testPath),
  });
  const enrichLog = (log: RawUserConsoleLog): UserConsoleLog => ({
    ...log,
    relativeTestPath: relative(context.rootPath, log.testPath),
  });

  const fileHooks = (file: { project: string; testPath: string }) => {
    const key = reporterFileKey(file.project, file.testPath);
    let hooks = run.files.get(key);
    if (!hooks) {
      hooks = new Set();
      run.files.set(key, hooks);
    }
    return hooks;
  };

  const dispatch = async <
    K extends Exclude<
      keyof Reporter,
      'flushOutputStreams' | 'onTestRunStart' | 'onTestRunEnd' | 'onExit'
    >,
  >(
    hook: K,
    payload: Parameters<NonNullable<Reporter[K]>>[0],
  ): Promise<void> => {
    const dispatched: Promise<void>[] = [];
    for (const [index, reporter] of reporters.entries()) {
      const recordError = (error: unknown) => {
        run.errors.push(
          new Error(
            `Reporter ${reporter.constructor.name} (#${index + 1}) ${hook} failed: ${toError(error).message}`,
            { cause: error },
          ),
        );
      };
      let result: MaybePromise<void>;
      try {
        // The hook key correlates its callback with this payload type.
        const invoke = reporter[hook] as
          | ((
              payload: Parameters<NonNullable<Reporter[K]>>[0],
            ) => MaybePromise<void>)
          | undefined;
        result = invoke?.call(reporter, payload);
      } catch (error) {
        recordError(error);
        continue;
      }
      if (!result?.then) continue;
      const hooks = fileHooks(payload);
      const promise = Promise.resolve(result)
        .catch(recordError)
        .finally(() => {
          hooks.delete(promise);
        });
      hooks.add(promise);
      dispatched.push(promise);
    }
    await Promise.all(dispatched);
  };

  return {
    onTestCaseStart(test) {
      const enriched = enrichTask(test);
      context.stateManager.onTestCaseStart(enriched);
      return dispatch('onTestCaseStart', enriched);
    },
    async onTestCaseResult(result) {
      const enriched = enrichResult(result);
      context.stateManager.onTestCaseResult(enriched);
      await dispatch('onTestCaseResult', enriched);
      return enriched;
    },
    async onTestFileStart(test) {
      const enriched = enrichFileInfo(test);
      context.stateManager.onTestFileStart(enriched.testPath);
      await dispatch('onTestFileStart', enriched);
    },
    async onTestFileReady(test) {
      const enriched = enrichFileInfo(test);
      await dispatch('onTestFileReady', enriched);
    },
    async onTestSuiteStart(test) {
      const enriched = enrichTask(test);
      await dispatch('onTestSuiteStart', enriched);
    },
    async onTestSuiteResult(result) {
      const enriched = enrichResult(result);
      await dispatch('onTestSuiteResult', enriched);
    },
    async onTestFileResult(result) {
      const pending = run.files.get(
        reporterFileKey(result.project, result.testPath),
      );
      if (pending) await joinHooks(pending);
      const results = result.results.map(enrichResult);
      const enriched: TestFileResult = {
        ...enrichResult(result),
        results,
        summary: getFileSummary(results),
      };
      context.stateManager.onTestFileResult(enriched);
      await dispatch('onTestFileResult', enriched);
      if (enriched.snapshotResult) {
        context.snapshotManager.add(enriched.snapshotResult);
      }
      return enriched;
    },
    async onConsoleLog(log) {
      if (projectConfig.disableConsoleIntercept) {
        return;
      }
      // Worker log delivery is fire-and-forget; report filter errors here.
      // Reporter hook errors are recorded by dispatch in run.errors.
      try {
        if (projectConfig.onConsoleLog?.(log.content, log.type) === false) {
          return;
        }
      } catch (error) {
        logger.error(
          color.red('Failed to handle console log:'),
          toError(error),
        );
        return;
      }
      await dispatch('onUserConsoleLog', enrichLog(log));
    },
    emitConsoleLog(log) {
      const enriched = enrichLog(log);
      return dispatch('onUserConsoleLog', enriched);
    },
    async emitTestCaseResult(result) {
      const enriched = enrichResult(result);
      await dispatch('onTestCaseResult', enriched);
      return enriched;
    },
    getCountOfFailedTests() {
      // `stateManager` is cleared before every cycle (the non-watch
      // top-of-run reset, and core's watch cycle driver ahead of each cycle
      // including a session's first), so this read is already cycle-scoped —
      // bail decisions never see failures a previous cycle, or a sibling
      // executor's cycle, recorded. Both the node pool and the browser host's
      // cross-file bail gate consult this.
      return context.stateManager.getCountOfFailedTests();
    },
    resolveSnapshotPath(testPath) {
      return resolveSnapshotPathDefault(
        testPath,
        projectConfig.resolveSnapshotPath,
      );
    },
  };
}

/**
 * Adapt a {@link RunnerEventSink} to the wire {@link RuntimeRPC} shape (minus
 * the task-scoped `getAssetsByEntry`, which stays where it is built). The
 * runner-facing method SET is compile-checked below, so the wire type and the
 * sink cannot drift — the #1389 class.
 */
export function sinkToRuntimeRpc(
  sink: RunnerEventSink,
): Omit<RuntimeRPC, 'getAssetsByEntry'> {
  return {
    onTestFileStart: (test) => sink.onTestFileStart(test),
    onTestFileReady: (test) => sink.onTestFileReady(test),
    onTestSuiteStart: (test) => sink.onTestSuiteStart(test),
    onTestSuiteResult: (result) => sink.onTestSuiteResult(result),
    onTestCaseStart: (test) => sink.onTestCaseStart(test),
    onTestCaseResult: async (result) => {
      await sink.onTestCaseResult(result);
    },
    getCountOfFailedTests: async () => sink.getCountOfFailedTests(),
    onConsoleLog: (log) => sink.onConsoleLog(log),
    resolveSnapshotPath: (testPath) => sink.resolveSnapshotPath(testPath),
  };
}

// Compile-time drift guard: the sink covers exactly the runner-facing RuntimeRPC
// methods — everything except the task-scoped `getAssetsByEntry` and whatever
// {@link HostDrivenEvents} declares. Adding a runner event on one side without
// the other collapses one of these to `never` and fails the assignment. The
// exclusions derive from that interface, so silencing this guard means moving a
// method into the host-driven category on purpose, not editing a name list.
type RunnerRpcMethod = keyof Omit<RuntimeRPC, 'getAssetsByEntry'>;
type SinkRpcMethod = keyof Omit<RunnerEventSink, keyof HostDrivenEvents>;
/**
 * The runner lifecycle events reporters observe — the wire methods minus the
 * host-answered queries. `BlobReporter`'s compile guard consumes this so a new
 * lifecycle event cannot ship without a blob track recording for it.
 */
export type RunnerLifecycleEvent = Exclude<
  SinkRpcMethod,
  'getCountOfFailedTests' | 'resolveSnapshotPath'
>;
type _SinkCoversRpc = RunnerRpcMethod extends SinkRpcMethod ? true : never;
type _RpcCoversSink = SinkRpcMethod extends RunnerRpcMethod ? true : never;
export const RUNNER_EVENT_SINK_MATCHES_RPC: _SinkCoversRpc & _RpcCoversSink =
  true;
