/**
 * Browser runtime exports for @rstest/browser client code.
 * This module only exports APIs that can run in the browser environment,
 * without any Node.js or build tool dependencies.
 *
 * Used by:
 * - packages/browser/src/client/entry.ts (runtime APIs)
 * - packages/browser/src/client/public.ts (test APIs via alias)
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
export { globalApis, RSTEST_ENV_SYMBOL_KEY } from './utils/constants';
// Browser-safe regexp wire-format decoder (mirrors the host-side encoder used
// by `serializableConfig`). Kept here so the client never re-declares it.
export { unwrapRegex } from './utils/regexpWireFormat';
