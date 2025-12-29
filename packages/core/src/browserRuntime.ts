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
// Types for browser runtime
export type {
  RunnerHooks,
  RuntimeConfig,
  Test,
  TestFileResult,
  TestResult,
  WorkerState,
} from './types';
// Constants needed by browser client
export { globalApis } from './utils/constants';
