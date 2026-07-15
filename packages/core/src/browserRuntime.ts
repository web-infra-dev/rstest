/**
 * Browser runtime exports for @rstest/browser client code.
 * This module only exports APIs that can run in the browser environment,
 * without any Node.js or build tool dependencies.
 *
 * Used by:
 * - packages/browser/src/client/entry.ts (runtime APIs)
 *
 * User test code importing '@rstest/core' is not aliased here; the browser
 * build keeps that request external against `globalThis['@rstest/core']`
 * (see `applyWebMockRspackConfig`), mirroring the node build's external.
 */

// Runtime API for creating test runtime in browser
export { createRstestRuntime } from './runtime/api';
// Public test APIs (describe, it, expect, etc.)
export * from './runtime/api/public';
export { setRealTimers } from './runtime/util';
export { createBrowserTaskContext } from './runtime/worker/taskContext.browser';
export type { TaskContext } from './runtime/worker/taskContext';
// Types for browser runtime
export type {
  BrowserRuntimeConfig,
  CoverageMapData,
  CurrentTaskInfo,
  RunnerHooks,
  RuntimeConfig,
  Test,
  TestFileResult,
  TestInfo,
  TestResult,
  WorkerState,
} from './types';
// Constants needed by browser client
export {
  globalApis,
  RSTEST_API_GLOBAL_KEY,
  RSTEST_ENV_SYMBOL_KEY,
} from './utils/constants';
// Node-parity console argument formatting for the browser console relay.
export { formatConsoleArgs } from './runtime/consoleFormat';
// Shared snapshot header so browser-written `.snap` files match node's.
export { SNAPSHOT_HEADER } from './utils/snapshotPath';
// Browser-safe regexp wire-format decoder (mirrors the host-side encoder used
// by `serializableConfig`). Kept here so the client never re-declares it.
export { unwrapRegex } from './utils/regexpWireFormat';
