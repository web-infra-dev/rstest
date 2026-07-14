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
   * Env base to inherit from; defaults to `process.env`. A post-globalSetup
   * snapshot is passed here once the pre-cycle stage exists.
   */
  env?: EnvSource;
}

interface StaticEnvOptions {
  /** Browser: emit only `NODE_ENV` + `RSTEST` plus user config env (#1351). */
  envMode: 'static';
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

  const envSource = options.env ?? process.env;

  if (options.envMode === 'static') {
    // Browser wire. Propagate NODE_ENV and the RSTEST flag from the host so
    // `process.env.NODE_ENV` / `process.env.RSTEST` (rewritten to the
    // `RSTEST_ENV_SYMBOL_KEY` symbol store) resolve in browser tests the same
    // way they do in Node mode. User-supplied `env` wins so explicit overrides
    // still take effect. See https://github.com/web-infra-dev/rstest/issues/1351
    return {
      ...shared,
      env: {
        NODE_ENV: envSource.NODE_ENV,
        RSTEST: 'true',
        ...env,
      },
    } satisfies BrowserRuntimeConfig;
  }

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
