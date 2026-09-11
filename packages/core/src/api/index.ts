/**
 * Programmatic Node API for running Rstest in-process.
 *
 * @experimental The programmatic API surface (`createRstest`,
 * `RstestInstance`, `RunOptions`, `WatchOptions`, `ListedTest`,
 * `TestRunResult`, `TestRunStatus`, and `ListTestsError`) is subject to change
 * until 1.0.0.
 */
export { createRstest } from './createRstest';
export { ListTestsError } from './listTestsError';
export { runCLI, type RunCLIOptions } from '../cli';
export type * from './types';
