/**
 * Internal exports for @rstest/browser package.
 * These APIs are not part of the public API and may change between versions.
 * @rstest/browser must have the same version as @rstest/core.
 */

// Re-export @rsbuild/core for @rstest/browser to avoid duplicate dependency
import * as rsbuild from '@rsbuild/core';
export { rsbuild };

// Re-export Rstest type for convenience
export type { Rstest } from './core/rstest';
// Coverage support for browser mode
export { loadCoverageProvider } from './coverage';
// Runtime API
export { createRstestRuntime } from './runtime/api';
// Public runtime API (for browser client usage)
// These are the test APIs that run in the browser (describe, it, expect, etc.)
export * from './runtime/api/public';
export { setRealTimers } from './runtime/util';
// Types
export type {
  BrowserTestRunOptions,
  BrowserTestRunResult,
  FormattedError,
  ListCommandResult,
  ProjectContext,
  Reporter,
  RunnerHooks,
  RuntimeConfig,
  Test,
  TestFileResult,
  TestResult,
  UserConsoleLog,
  WorkerState,
} from './types';
// Utils needed by browser package
export { color, isDebug, logger, serializableConfig } from './utils';
// Constants
export { globalApis, TEMP_RSTEST_OUTPUT_DIR } from './utils/constants';
export { getSetupFiles } from './utils/getSetupFiles';
export { getTestEntries } from './utils/testFiles';
