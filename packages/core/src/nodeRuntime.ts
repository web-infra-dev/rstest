/**
 * Internal Node-worker runtime hooks for first-party integrations such as
 * `@rstest/playwright`.
 *
 * `@rstest/playwright` depends on `@rstest/core` through a peer range rather
 * than an exact lockstep version, so keep these exports backwards-compatible
 * within a major release line.
 */
export {
  registerFileCleanup,
  type FileCleanup,
} from './runtime/runner/fileCleanup';
export {
  registerWorkerCleanup,
  type WorkerCleanup,
} from './runtime/runner/workerCleanup';
