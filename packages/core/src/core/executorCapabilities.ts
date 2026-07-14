import type { RuntimeConfig } from '../types';

export type CapabilityStatus =
  /** Consumed by this executor. */
  | 'supported'
  /** Reaches this executor's wire but is a no-op; non-default values warn. */
  | 'ignored-warn'
  /** Unsupported; a non-default value is a hard error. */
  | 'error'
  /** Never sent to this executor's wire (dropped by the projection). */
  | 'stripped';

/**
 * Declarative per-executor disposition of EVERY {@link RuntimeConfig} field.
 *
 * The exhaustive `Record<keyof RuntimeConfig, …>` is the structural gate
 * against the #1389 class of bugs: adding a field to `RuntimeConfig` without a
 * row here is a COMPILE error, forcing an explicit node/browser disposition
 * instead of a silent no-op on the browser wire.
 *
 * Consumers keep in lockstep with this table via tests:
 * - `runtimeConfigProjection` (the browser `static` projection omits exactly
 *   the `browser: 'stripped'` fields — see {@link browserStrippedRuntimeConfigKeys}).
 * - the browser-mode validation pass warns on the `stripped` / `ignored-warn`
 *   fields when set to a non-default value.
 */
export const executorCapabilities: Record<
  keyof RuntimeConfig,
  { node: CapabilityStatus; browser: CapabilityStatus }
> = {
  testTimeout: { node: 'supported', browser: 'supported' },
  testNamePattern: { node: 'supported', browser: 'supported' },
  globals: { node: 'supported', browser: 'supported' },
  passWithNoTests: { node: 'supported', browser: 'supported' },
  retry: { node: 'supported', browser: 'supported' },
  clearMocks: { node: 'supported', browser: 'supported' },
  resetMocks: { node: 'supported', browser: 'supported' },
  restoreMocks: { node: 'supported', browser: 'supported' },
  unstubEnvs: { node: 'supported', browser: 'supported' },
  unstubGlobals: { node: 'supported', browser: 'supported' },
  maxConcurrency: { node: 'supported', browser: 'supported' },
  printConsoleTrace: { node: 'supported', browser: 'supported' },
  disableConsoleIntercept: { node: 'supported', browser: 'supported' },
  // Stripped from the browser wire; the client hardcodes `environment: 'browser'`.
  testEnvironment: { node: 'supported', browser: 'stripped' },
  // Reaches the browser but is a no-op today (each file runs in a fresh
  // context); a real browser `isolate: false` is a future executor fork.
  isolate: { node: 'supported', browser: 'ignored-warn' },
  hookTimeout: { node: 'supported', browser: 'supported' },
  // Browser coverage is host-wired, not client-read.
  coverage: { node: 'supported', browser: 'stripped' },
  snapshotFormat: { node: 'supported', browser: 'supported' },
  env: { node: 'supported', browser: 'supported' },
  // Node process mechanisms.
  logHeapUsage: { node: 'supported', browser: 'stripped' },
  detectAsyncLeaks: { node: 'supported', browser: 'stripped' },
  bail: { node: 'supported', browser: 'supported' },
  chaiConfig: { node: 'supported', browser: 'supported' },
  includeTaskLocation: { node: 'supported', browser: 'supported' },
  silent: { node: 'supported', browser: 'supported' },
};

const runtimeConfigKeys = Object.keys(
  executorCapabilities,
) as (keyof RuntimeConfig)[];

/** RuntimeConfig fields never sent to the browser wire. */
export const browserStrippedRuntimeConfigKeys: (keyof RuntimeConfig)[] =
  runtimeConfigKeys.filter(
    (key) => executorCapabilities[key].browser === 'stripped',
  );

/**
 * RuntimeConfig fields the browser accepts on the wire but does not honor, plus
 * the stripped ones — i.e. every field a browser project should warn about when
 * set to a non-default value.
 */
export const browserIgnoredRuntimeConfigKeys: (keyof RuntimeConfig)[] =
  runtimeConfigKeys.filter((key) =>
    ['stripped', 'ignored-warn'].includes(executorCapabilities[key].browser),
  );
