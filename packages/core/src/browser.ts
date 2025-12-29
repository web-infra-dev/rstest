/**
 * Internal exports for @rstest/browser package.
 * These APIs are not part of the public API and may change between versions.
 * @rstest/browser must have the same version as @rstest/core.
 */

// Runtime API
export { createRstestRuntime } from './runtime/api';
export { setRealTimers } from './runtime/util';

// Constants
export { globalApis } from './utils/constants';

// Utils needed by browser package
export { color, isDebug, logger, serializableConfig } from './utils';
export { TEMP_RSTEST_OUTPUT_DIR } from './utils/constants';
export { getSetupFiles } from './utils/getSetupFiles';
export { getTestEntries } from './utils/testFiles';

// Public runtime API (for browser client usage)
// These are the test APIs that run in the browser (describe, it, expect, etc.)
export * from './runtime/api/public';

// Types
export type {
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

// Re-export Rstest type for convenience
export type { Rstest } from './core/rstest';
