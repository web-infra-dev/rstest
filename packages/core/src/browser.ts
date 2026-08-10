/**
 * Internal exports for @rstest/browser package.
 * These APIs are not part of the public API and may change between versions.
 * @rstest/browser must have the same version as @rstest/core.
 */

// Re-export @rsbuild/core for @rstest/browser to avoid duplicate dependency
import * as rsbuild from '@rsbuild/core';

// Core-owned contract for the host module that @rstest/browser implements
export type {
  BrowserHostModule,
  BrowserTestExecutor,
  CreateBrowserExecutorOptions,
} from './core/browser/loader';
// Shared coverage fold: the browser executor and the browser-only watch path
// merge per-file result coverage through the same helper.
export { buildBrowserCoverageMap } from './coverage/browserCoverageMap';
// The executor seam — `@rstest/browser`'s browser executor is built against
// `TestExecutor` and returns an `ExecutorCycleOutcome`, so the shared
// `finalizeRunCycle` reduces it alongside the node outcome. Transitive dts
// exposure through `BrowserHostModule` is not enough; these must be named here.
export type {
  ExecutorCycleOutcome,
  ExecutorInvalidationCallback,
  ExecutorRunCycleOptions,
  TestExecutor,
} from './types';
// The executor-capability table's list of RuntimeConfig keys the browser wire
// ignores/strips; the browser config validation iterates it so a new
// ignored/stripped row can't become a silent no-op (#1389).
export { browserIgnoredRuntimeConfigKeys } from './core/executorCapabilities';
// Single core-owned RuntimeConfig projection (node inherit / browser static)
export { projectRuntimeConfig } from './core/runtimeConfigProjection';
// Shared runner-event pump so the browser host feeds stateManager and fans out
// to reporters through the same implementation as the node pool.
export {
  createRunnerEventSink,
  type RunnerEventSink,
} from './core/runnerEventSink';
// Shared snapshot path resolver so the browser host matches the node pool
export {
  resolveSnapshotPathDefault,
  SNAPSHOT_HEADER,
} from './utils/snapshotPath';
// Shared watch-ready banner so the browser host prints the same hint text as
// the node watch loop.
export { logWatchReadyMessage } from './core/cliShortcuts';
// Shared watch invalidation policy (chunk-hash diff + setup-change=>rerun-all)
// so the browser watch plugin applies the same rerun rules as the node
// dev-compile pipeline, with baselines keyed per project.
export {
  applyWatchInvalidation,
  type EntryHashSnapshot,
  type WatchInvalidationState,
} from './core/watchInvalidation';
// Shared silent-console buffering engine so the browser host replays
// `silent: 'passed-only'` logs through the same controller as the node worker.
export { createSilentConsoleController } from './runtime/worker/silentConsole';
// Shared console level coloring so the browser host's log relay prints the
// same level prefixes as the node worker's CustomConsole.
export { getPrettyConsoleName } from './runtime/worker/console';
// Core-owned mock build parameterization: the browser host registers the same
// mock transform pipeline as the node build (web parameterization).
export {
  applyWebMockRspackConfig,
  importMetaRstestDefine,
} from './core/plugins/mockBuild';
// The mock runtime plugin (importActual doppelganger rule + webpack runtime
// module) is target-agnostic; the browser host registers it per project.
export { pluginMockRuntime } from './core/plugins/mockRuntime';
// Re-export Rstest type for convenience
export type { Rstest } from './core/rstest';
// Coverage support for browser mode
export { createCoverageProvider, loadCoverageProvider } from './coverage';
export {
  getUserRstestConfigPluginProjects,
  hasUserRstestConfigPlugins,
  initModifyRstestConfigHooks,
} from './core/modifyRstestConfig';
// Trace primitives — the browser host instantiates PhaseTracker per test file
// and forwards its events via `BrowserTestRunOptions.onTraceEvents`.
export { PhaseTracker } from './runtime/worker/phaseTracker';
export { createFileCleanupTimeoutResult } from './runtime/runner/fileCleanup';
// Types
export type {
  BrowserRuntimeConfig,
  BrowserTestRunOptions,
  BrowserTestRunResult,
  BrowserViewport,
  CoverageMapData,
  CoverageProvider,
  DevicePreset,
  FormattedError,
  ListBrowserTestsOptions,
  ListCommandResult,
  ProjectContext,
  Reporter,
  RstestContext,
  RunnerHooks,
  RuntimeConfig,
  Test,
  TestFileResult,
  TestResult,
  UserConsoleLog,
  WorkerState,
} from './types';
// Utils needed by browser package
export { color, isDebug, isTTY, logger, serializableConfig } from './utils';
// Shared fatal-signal list, so the host's best-effort runtime cleanup nets hook
// the same signals core's watch teardown exits on.
export { FATAL_SIGNALS } from './utils/signals';
// Worker concurrency primitives shared with @rstest/browser
export { getNumCpus, parseWorkers, resolveWorkerCount } from './utils/workers';
export type { ResolveWorkerCountOptions } from './utils/workers';
// Constants
export {
  BROWSER_PROVIDERS,
  DEFAULT_TEST_TIMEOUT,
  FIXTURE_CLEANUP_TIMEOUT_MS,
  resolveProjectBuildCache,
  RSTEST_ENV_SYMBOL_KEY,
} from './utils/constants';
export type { BrowserProvider } from './utils/constants';
export { getSetupFiles } from './utils/getSetupFiles';
export { resolveShardedEntries } from './utils/shard';
export { getTestEntries } from './utils/testFiles';
export { rsbuild };
