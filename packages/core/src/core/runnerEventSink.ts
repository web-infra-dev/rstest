import type {
  ProjectContext,
  RstestContext,
  RuntimeRPC,
  TestCaseInfo,
  TestFileInfo,
  TestFileResult,
  TestResult,
  TestSuiteInfo,
  UserConsoleLog,
} from '../types';
import { color, logger, toError } from '../utils';
import { resolveSnapshotPathDefault } from '../utils/snapshotPath';

/**
 * The single event pump for runner lifecycle events, shared by the node pool
 * RPC and (from Phase 2's browser adoption) the browser dispatch runner
 * namespace. One implementation feeds `stateManager`, fans out to reporters,
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
  onTestFileResult(result: TestFileResult): Promise<void>;
  /**
   * Reporter fanout without the filter, for output already filtered once — the
   * merge-reports replay, whose logs only reached the blob because the
   * recording run's filter admitted them. Re-filtering there could drop output
   * the recorded run kept, and honoring `disableConsoleIntercept` here would
   * let a merge-side config silently swallow logs the recording run captured.
   * Carries no project-scoped behavior, so any project's sink will do.
   */
  emitConsoleLog(log: UserConsoleLog): Promise<void>;
}

export interface RunnerEventSink extends HostDrivenEvents {
  /** FIRE-AND-FORGET on both transports (matches node's unawaited fanout). */
  onTestCaseStart(test: TestCaseInfo): void;
  onTestFileStart(test: TestFileInfo): Promise<void>;
  onTestFileReady(test: TestFileInfo): Promise<void>;
  onTestSuiteStart(test: TestSuiteInfo): Promise<void>;
  onTestSuiteResult(result: TestResult): Promise<void>;
  onTestCaseResult(result: TestResult): Promise<void>;
  /** Applies the owning project's `onConsoleLog` filter before reporter fanout. */
  onConsoleLog(log: UserConsoleLog): Promise<void>;
  getCountOfFailedTests(): number;
  /** Resolves via the owning project's `resolveSnapshotPath` (per-project). */
  resolveSnapshotPath(testPath: string): string;
}

export function createRunnerEventSink(
  context: RstestContext,
  projectConfig: ProjectContext['normalizedConfig'],
): RunnerEventSink {
  const { reporters } = context;

  const fanoutConsoleLog = async (log: UserConsoleLog): Promise<void> => {
    await Promise.all(
      reporters.map((reporter) => reporter.onUserConsoleLog?.(log)),
    );
  };

  // The worker forwards console output fire-and-forget: a delivery failure is
  // dropped in the worker, and an error thrown here cannot travel back to fail
  // the originating test. A user `onConsoleLog` filter or a reporter
  // `onUserConsoleLog` that throws is a real defect, though, so surface it
  // here — where it occurs — rather than letting it vanish.
  const guarded = async (handle: () => Promise<void>): Promise<void> => {
    try {
      await handle();
    } catch (error) {
      logger.error(color.red('Failed to handle console log:'), toError(error));
    }
  };

  return {
    onTestCaseStart(test) {
      context.stateManager.onTestCaseStart(test);
      // Fire-and-forget: reporter case-start hooks are not awaited (parity with
      // the node pool), so they never gate the runner's next step.
      void Promise.all(
        reporters.map((reporter) => reporter.onTestCaseStart?.(test)),
      );
    },
    async onTestCaseResult(result) {
      context.stateManager.onTestCaseResult(result);
      await Promise.all(
        reporters.map((reporter) => reporter.onTestCaseResult?.(result)),
      );
    },
    async onTestFileStart(test) {
      context.stateManager.onTestFileStart(test.testPath);
      await Promise.all(
        reporters.map((reporter) => reporter.onTestFileStart?.(test)),
      );
    },
    async onTestFileReady(test) {
      await Promise.all(
        reporters.map((reporter) => reporter.onTestFileReady?.(test)),
      );
    },
    async onTestSuiteStart(test) {
      await Promise.all(
        reporters.map((reporter) => reporter.onTestSuiteStart?.(test)),
      );
    },
    async onTestSuiteResult(result) {
      await Promise.all(
        reporters.map((reporter) => reporter.onTestSuiteResult?.(result)),
      );
    },
    async onTestFileResult(result) {
      context.stateManager.onTestFileResult(result);
      await Promise.all(
        reporters.map((reporter) => reporter.onTestFileResult?.(result)),
      );
      if (result.snapshotResult) {
        context.snapshotManager.add(result.snapshotResult);
      }
    },
    async onConsoleLog(log) {
      if (projectConfig.disableConsoleIntercept) {
        return;
      }
      await guarded(async () => {
        if (projectConfig.onConsoleLog?.(log.content, log.type) === false) {
          return;
        }
        await fanoutConsoleLog(log);
      });
    },
    emitConsoleLog(log) {
      return guarded(() => fanoutConsoleLog(log));
    },
    getCountOfFailedTests() {
      // `stateManager` is reset at the top of every run/rerun (node's
      // top-of-cycle reset and the browser host's `prepareWatchRerunState`), so
      // this read is already cycle-scoped — bail decisions never see counts
      // carried over from a previous cycle. Both the node pool and the browser
      // host's cross-file bail gate consult this.
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
    onTestCaseStart: async (test) => sink.onTestCaseStart(test),
    onTestCaseResult: (result) => sink.onTestCaseResult(result),
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
type _SinkCoversRpc = RunnerRpcMethod extends SinkRpcMethod ? true : never;
type _RpcCoversSink = SinkRpcMethod extends RunnerRpcMethod ? true : never;
export const RUNNER_EVENT_SINK_MATCHES_RPC: _SinkCoversRpc & _RpcCoversSink =
  true;
