import type {
  BrowserRuntimeConfig,
  ProjectContext,
  RuntimeConfig,
} from '../types';

type EnvSource = Record<string, string | undefined>;

interface InheritEnvOptions {
  /** Node: spread the full env (defaults to `process.env`). */
  envMode: 'inherit';
  /**
   * Full env base to inherit from; defaults to `process.env`, read at
   * projection time so globalSetup mutations are already applied.
   */
  env?: EnvSource;
}

interface StaticEnvOptions {
  /** Browser: emit only `NODE_ENV` + `RSTEST` plus user config env (#1351). */
  envMode: 'static';
  /**
   * Overlay change-set (post-globalSetup env diff), NOT a full env base:
   * applied between the static base and the user config env. Arbitrary host
   * env must never be passed here — it would leak onto the browser wire.
   */
  env?: EnvSource;
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
    testEnvironment,
    hookTimeout,
    isolate,
    coverage,
    snapshotFormat,
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
    bail,
    chaiConfig,
    includeTaskLocation,
    silent,
  };

  if (options.envMode === 'static') {
    // Browser wire. Propagate NODE_ENV and the RSTEST flag from the host so
    // `process.env.NODE_ENV` / `process.env.RSTEST` (rewritten to the
    // `RSTEST_ENV_SYMBOL_KEY` symbol store) resolve in browser tests the same
    // way they do in Node mode. The globalSetup change-set overlays the base;
    // user-supplied `env` wins so explicit overrides still take effect.
    // Deletions (`undefined` values) are no-ops on the wire: JSON
    // serialization drops them, and host-only vars never existed in the
    // browser store. See https://github.com/web-infra-dev/rstest/issues/1351
    return {
      ...shared,
      env: {
        NODE_ENV: process.env.NODE_ENV,
        RSTEST: 'true',
        ...options.env,
        ...env,
      },
    } satisfies BrowserRuntimeConfig;
  }

  const envSource = options.env ?? process.env;

  return {
    ...shared,
    testEnvironment,
    // `reporters` may be functions, which are not serializable — strip them.
    coverage: { ...coverage, reporters: [] },
    logHeapUsage,
    detectAsyncLeaks,
    env: {
      // Read env at projection time so a globalSetup-modified `process.env`
      // (or an explicit snapshot) is captured correctly.
      ...envSource,
      ...env,
    },
  } satisfies RuntimeConfig;
}
