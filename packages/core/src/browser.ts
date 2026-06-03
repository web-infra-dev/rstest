/**
 * Internal exports for @rstest/browser package.
 * These APIs are not part of the public API and may change between versions.
 * @rstest/browser must have the same version as @rstest/core.
 */

// Re-export @rsbuild/core for @rstest/browser to avoid duplicate dependency
import * as rsbuild from '@rsbuild/core';

// Core-owned contract for the host module that @rstest/browser implements
export type { BrowserHostModule } from './core/browserLoader';
// Re-export Rstest type for convenience
export type { Rstest } from './core/rstest';
// Coverage support for browser mode
export { createCoverageProvider, loadCoverageProvider } from './coverage';
// Trace primitives — the browser host instantiates PhaseTracker per test file
// and forwards its events via `BrowserTestRunOptions.onTraceEvents`.
export { PhaseTracker } from './runtime/worker/phaseTracker';
// Types
export type {
  BrowserTestRunOptions,
  BrowserTestRunResult,
  CoverageMapData,
  DevicePreset,
  FormattedError,
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
export { getNumCpus, parseWorkers } from './utils/workers';
// Constants
export { resolveProjectBuildCache } from './utils/constants';
export { getSetupFiles } from './utils/getSetupFiles';
export { getTestEntries } from './utils/testFiles';
export { rsbuild };
