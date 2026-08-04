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
  /** Set to `'true'` while a test run is active. See {@link applyTestEnvMarkers}. */
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

/**
 * A `globalSetup` env change-set, as its worker reported it back: `undefined`
 * means the setup deleted that key.
 *
 * The producer (the setup fork) and every consumer (a node worker's own
 * `process.env`, the browser wire, the env a child is spawned with) must agree
 * on that encoding, so it is applied through {@link applyEnvChanges} rather
 * than re-spelled per site.
 */
export type EnvChanges = Record<string, string | undefined>;

/** Apply `changes` to `target`, deleting the keys it maps to `undefined`. */
export const applyEnvChanges = (
  target: NodeJS.ProcessEnv,
  changes: EnvChanges,
): void => {
  for (const key of Object.keys(changes)) {
    const value = changes[key];
    if (value === undefined) {
      Reflect.deleteProperty(target, key);
    } else {
      target[key] = value;
    }
  }
};

/**
 * Stamp the two markers that identify a process as running Rstest tests.
 *
 * Applied to the host (`cli/prepare.ts`, so config evaluation and Rsbuild see
 * them) and to every environment a test then runs in — a spawned child's env
 * and the browser wire. One owner, because a host and its workers disagreeing
 * on `NODE_ENV` is invisible until a user's config branches on it.
 *
 * `NODE_ENV` yields to a value the caller already chose; `RSTEST` does not,
 * since nothing but Rstest sets it.
 */
export const applyTestEnvMarkers = (env: NodeJS.ProcessEnv): void => {
  if (!env.NODE_ENV) {
    env.NODE_ENV = 'test';
  }
  env[ENV.RSTEST] = 'true';
};
