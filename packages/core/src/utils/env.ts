/**
 * Single source of truth for Rstest's `process.env.*` variable names.
 *
 * Each of these is read and/or written from more than one module, so spelling
 * the literal out at every site is a drift hazard — a typo or rename on one
 * side silently breaks the producer/consumer pairing. Reference `ENV.*` instead
 * so the name lives in exactly one place.
 *
 * Scope this to environment-variable *names* only. Internal `globalThis` keys
 * and `import.meta` hook keys are a different surface and live with their own
 * modules (e.g. `runtime/worker/runtimeHooks.ts`).
 */
export const ENV = {
  /** Set to `'true'` while a test run is active (set in `cli/prepare.ts`). */
  RSTEST: 'RSTEST',
  /** User override for `output.module`; `'false'` disables ESM output. */
  OUTPUT_MODULE: 'RSTEST_OUTPUT_MODULE',
  /** Per-worker id exposed so user code can partition finite resources. */
  WORKER_ID: 'RSTEST_WORKER_ID',
  /** Emergency kill switch for the memory-aware pool gate (`'0'` disables). */
  MEMORY_AWARE: 'RSTEST_MEMORY_AWARE',
  /** Set to `'1'` to force-disable agent (CI assistant) detection. */
  NO_AGENT: 'RSTEST_NO_AGENT',
} as const;
