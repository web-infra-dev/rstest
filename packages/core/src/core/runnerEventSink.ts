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
export interface RunnerEventSink {
  /** FIRE-AND-FORGET on both transports (matches node's unawaited fanout). */
  onTestCaseStart(test: TestCaseInfo): void;
  /**
   * AWAITED by both transports, and ingests `result.snapshotResult`. This is a
   * host-driven event (not part of the wire {@link RuntimeRPC}); the pool calls
   * it after `pool.runTest` returns, the browser host after a client file
   * completes.
   */
  onTestFileResult(result: TestFileResult): Promise<void>;
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
      // The worker forwards console output fire-and-forget: a delivery failure
      // is dropped in the worker, and an error thrown here cannot travel back to
      // fail the originating test. A user `onConsoleLog` filter or a reporter
      // `onUserConsoleLog` that throws is a real defect, though, so surface it
      // here — where it occurs — rather than letting it vanish.
      if (projectConfig.disableConsoleIntercept) {
        return;
      }
      try {
        if (projectConfig.onConsoleLog?.(log.content, log.type) === false) {
          return;
        }
        await Promise.all(
          reporters.map((reporter) => reporter.onUserConsoleLog?.(log)),
        );
      } catch (error) {
        logger.error(
          color.red('Failed to handle console log:'),
          toError(error),
        );
      }
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
// methods — everything except the task-scoped `getAssetsByEntry` and the
// host-driven `onTestFileResult`. Adding a runner event on one side without the
// other collapses one of these to `never` and fails the assignment.
type RunnerRpcMethod = keyof Omit<RuntimeRPC, 'getAssetsByEntry'>;
type SinkRpcMethod = keyof Omit<RunnerEventSink, 'onTestFileResult'>;
type _SinkCoversRpc = RunnerRpcMethod extends SinkRpcMethod ? true : never;
type _RpcCoversSink = SinkRpcMethod extends RunnerRpcMethod ? true : never;
export const RUNNER_EVENT_SINK_MATCHES_RPC: _SinkCoversRpc & _RpcCoversSink =
  true;
