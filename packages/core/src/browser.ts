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
} from './core/browserLoader';
// Shared coverage fold: the browser executor and the browser-only watch path
// merge per-file result coverage through the same helper.
export { buildBrowserCoverageMap } from './coverage/browserCoverageMap';
// The executor seam — `@rstest/browser`'s `BrowserExecutor` writes
// `implements TestExecutor` and returns an `ExecutorCycleOutcome` so the shared
// `finalizeRunCycle` reduces it alongside the node outcome. Transitive dts
// exposure through `BrowserHostModule` is not enough; these must be named here.
export type {
  ExecutorCycleOutcome,
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
// Shared per-cycle state reset so the browser host and the node pool clear
// stateManager/snapshotManager identically at the start of each watch rerun.
export { prepareWatchRerunState } from './core/watchState';
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
export {
  color,
  getNoTestFilesMessage,
  isDebug,
  isTTY,
  logger,
  serializableConfig,
} from './utils';
// Worker concurrency primitives shared with @rstest/browser
export { getNumCpus, parseWorkers, resolveWorkerCount } from './utils/workers';
export type { ResolveWorkerCountOptions } from './utils/workers';
// Constants
export {
  BROWSER_PROVIDERS,
  DEFAULT_TEST_TIMEOUT,
  resolveProjectBuildCache,
  RSTEST_ENV_SYMBOL_KEY,
} from './utils/constants';
export type { BrowserProvider } from './utils/constants';
export { getSetupFiles } from './utils/getSetupFiles';
export { resolveShardedEntries } from './utils/shard';
export { getTestEntries } from './utils/testFiles';
export { rsbuild };
