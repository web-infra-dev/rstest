import type {
  BrowserRuntimeConfig,
  ProjectContext,
  RuntimeConfig,
} from '../types';
import { applyTestEnvMarkers, type EnvChanges } from '../utils';

interface InheritEnvOptions {
  /** Node: spread the full env. */
  envMode: 'inherit';
  /**
   * Full env base a node worker inherits — required, so this projection never
   * reads the host `process.env` itself. `composeWorkerEnv` builds it from a
   * host snapshot plus this run's `globalSetup` change-set.
   */
  env: NodeJS.ProcessEnv;
}

interface StaticEnvOptions {
  /** Browser: emit only `NODE_ENV` + `RSTEST` plus user config env (#1351). */
  envMode: 'static';
  /**
   * Overlay change-set (post-globalSetup env diff), NOT a full env base:
   * applied between the static base and the user config env. Arbitrary host
   * env must never be passed here — it would leak onto the browser wire.
   * Named apart from the inherit branch's `env` so a full `process.env`
   * cannot be passed by symmetry and still typecheck.
   */
  envOverlay?: EnvChanges;
}

/**
 * The single core-owned projection from a `ProjectContext` to a runtime config.
 * Node mode (`envMode: 'inherit'`) returns the full {@link RuntimeConfig};
 * browser mode (`envMode: 'static'`) returns the narrowed
 * {@link BrowserRuntimeConfig}. Replaces the two drifted copies previously in
 * `pool/index.ts` and `hostController.ts`.
 */
export function projectRuntimeConfig(
  project: ProjectContext,
  options: InheritEnvOptions,
): RuntimeConfig;
export function projectRuntimeConfig(
  project: ProjectContext,
  options: StaticEnvOptions,
): BrowserRuntimeConfig;
export function projectRuntimeConfig(
  project: ProjectContext,
  options: InheritEnvOptions | StaticEnvOptions,
): RuntimeConfig | BrowserRuntimeConfig {
  const {
    testNamePattern,
    testTimeout,
    passWithNoTests,
    retry,
    globals,
    clearMocks,
    resetMocks,
    restoreMocks,
    unstubEnvs,
    unstubGlobals,
    maxConcurrency,
    printConsoleTrace,
    disableConsoleIntercept,
    federation,
    testEnvironment,
    hookTimeout,
    isolate,
    coverage,
    snapshotFormat,
    expect,
    env,
    logHeapUsage,
    detectAsyncLeaks,
    bail,
    chaiConfig,
    includeTaskLocation,
    silent,
  } = project.normalizedConfig;

  const shared = {
    testNamePattern,
    testTimeout,
    hookTimeout,
    passWithNoTests,
    retry,
    globals,
    clearMocks,
    resetMocks,
    restoreMocks,
    unstubEnvs,
    unstubGlobals,
    maxConcurrency,
    printConsoleTrace,
    disableConsoleIntercept,
    isolate,
    snapshotFormat,
    expect,
    bail,
    chaiConfig,
    includeTaskLocation,
    silent,
  };

  if (options.envMode === 'static') {
    // Browser wire: carry only the markers plus user config env, never host env
    // (#1351). `process.env.NODE_ENV` is a deliberate read — a browser test
    // must see what a node worker sees, and the host holds the value both
    // derive from. Deletions in the overlay are no-ops here: JSON drops
    // `undefined`, and a host-only var was never in the browser store to begin
    // with.
    const markers: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV };
    applyTestEnvMarkers(markers);

    return {
      ...shared,
      // User config env wins over the setup's overlay, which wins over markers.
      env: { ...markers, ...options.envOverlay, ...env },
    } satisfies BrowserRuntimeConfig;
  }

  return {
    ...shared,
    federation,
    testEnvironment,
    // `reporters` may be functions, which are not serializable — strip them.
    coverage: { ...coverage, reporters: [] },
    logHeapUsage,
    detectAsyncLeaks,
    env: {
      // Composed by the caller at projection time, so a `globalSetup` that ran
      // after the worker pool was created is included.
      ...options.env,
      ...env,
    },
  } satisfies RuntimeConfig;
}
