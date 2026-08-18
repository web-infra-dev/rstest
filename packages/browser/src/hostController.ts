import fs from 'node:fs/promises';
import {
  type BrowserTestRunOptions,
  type BrowserTestRunResult,
  buildBrowserCoverageMap,
  type ExecutorCycleOutcome,
  type ExecutorInvalidationCallback,
  type ListBrowserTestsOptions,
  color,
  createCoverageProvider,
  createRunnerEventSink,
  createSilentConsoleController,
  DEFAULT_TEST_TIMEOUT,
  type FormattedError,
  getPrettyConsoleName,
  hasUserRstestConfigPlugins,
  isDebug,
  isTTY,
  type ListCommandResult,
  logger,
  logWatchReadyMessage,
  projectRuntimeConfig,
  PhaseTracker,
  type ProjectContext,
  type RunnerEventSink,
  type RstestContext,
  resolveSnapshotPathDefault,
  serializableConfig,
  type TestFileResult,
  type TestResult,
  type UserConsoleLog,
} from '@rstest/core/internal/browser';
import { dirname, join, normalize } from 'pathe';
import {
  createHostDispatchRouter,
  type HostDispatchRouterOptions,
} from './dispatchCapabilities';
import {
  collectProjectEntries,
  createBrowserRuntime,
  destroyBrowserRuntime,
  drainPendingBuildTime,
  getBrowserProjects,
  type BrowserProjectServer,
  type BrowserProviderProject,
  resolveContainerDist,
  resolveProjectEntries,
  serializeForInlineScript,
  type BrowserRuntime,
} from './browserRsbuild';
import {
  takeBrowserV8Coverage,
  type BrowserV8CoverageResourceStore,
} from './browserV8Coverage';
import { createHeadedScheduler } from './headedScheduler';
import { createHeadlessScheduler } from './headlessScheduler';
import type {
  BrowserDispatchRequest,
  BrowserHostConfig,
  BrowserProjectRuntime,
  BrowserRpcRequest,
  RunnerEnvelope,
  SnapshotRpcRequest,
  TestFileInfo,
} from './protocol';
import {
  DISPATCH_MESSAGE_TYPE,
  DISPATCH_NAMESPACE_BROWSER,
  NO_RPC_TIMEOUT,
  validateBrowserRpcRequest,
} from './protocol';
import {
  type BrowserProvider,
  type BrowserProviderImplementation,
  type BrowserProviderPage,
  type BrowserV8CoverageCollector,
  getBrowserProviderImplementation,
} from './providers';
import {
  type FatalPayload,
  getFileTaskId,
  type LogPayload,
  type TestCaseStartPayload,
  type TestFileReadyPayload,
  type TestFileStartPayload,
  type TestSuiteResultPayload,
  type TestSuiteStartPayload,
  toError,
} from './hostPayloads';
import {
  loadSourceMapWithCache,
  normalizeJavaScriptUrl,
  type SourceMapPayload,
} from './sourceMap/sourceMapLoader';
import { collectWatchTestFiles } from './watchRerunPlanner';
import type {
  BrowserWatchSession,
  DispatchPageResolver,
} from './schedulerSeam';
import { registerWatchCleanup, watchContext } from './watchRuntime';
import { createWatchSignals } from './watchSignals';

/**
 * Monotonic counter for synthetic per-file Perfetto `pid` values in `--trace`
 * mode. Browser host runs every test file inside the same Node process, so
 * without an override every file would emit events under the same `pid` and
 * share a single track labelled `worker <hostPid>`. Giving each file its own
 * synthetic `pid` makes the track title surface the file path instead,
 * matching node mode's default `isolate: true` behavior. The 1_000_000_000
 * base keeps each synthetic `pid` well clear of real OS `pid` values in
 * mixed-mode traces.
 */
let nextBrowserFilePid = 1_000_000_000;

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * The exit code a launch that found no test files at all must leave behind.
 *
 * Core's `reportNoTestFiles` owns the message and the no-test reporter
 * lifecycle for such a launch, but in watch mode its report deliberately leaves
 * the exit code alone — a rerun matching nothing is not a failure. Such a launch
 * opened no session, so no later cycle can raise the code either. That makes
 * this the only launch path that raises the context exit code directly: a boot
 * failure rides the outcome out of `failWithError` and core raises it from
 * there. One-shot runs keep going through the cycle, and a caller that passed
 * `allowEmptyRun` reads the outcome instead of the context status.
 */
const resolveEmptyLaunchExitCode = (
  current: number,
  {
    allowEmptyRun,
    isWatchMode,
    passWithNoTests,
  }: {
    allowEmptyRun: boolean;
    isWatchMode: boolean;
    passWithNoTests: boolean;
  },
): number => {
  if (allowEmptyRun || !isWatchMode || passWithNoTests) {
    return current;
  }
  // Never downgrade: a code already raised by an earlier failure stands.
  return Math.max(current, 1);
};

const getMaxTestTimeoutForRpc = (projects: ProjectContext[]): number =>
  Math.max(
    ...projects.map(
      (p) => p.normalizedConfig.testTimeout ?? DEFAULT_TEST_TIMEOUT,
    ),
  );

const resolveProviderForTestPath = ({
  testPath,
  browserProjects,
}: {
  testPath: string;
  browserProjects: BrowserProviderProject[];
}): BrowserProvider => {
  const normalizedTestPath = normalize(testPath);
  const sortedProjects = [...browserProjects].sort(
    (a, b) => b.rootPath.length - a.rootPath.length,
  );

  for (const project of sortedProjects) {
    if (normalizedTestPath.startsWith(project.rootPath)) {
      return project.provider;
    }
  }

  throw new Error(
    `Cannot resolve browser provider for test path: ${JSON.stringify(testPath)}. ` +
      `Known project roots: ${JSON.stringify(sortedProjects.map((p) => p.rootPath))}`,
  );
};

// ============================================================================

export type BrowserControllerOptions = BrowserTestRunOptions & {
  /**
   * Watch only: core's watch-cycle driver (see `TestExecutor.onInvalidate`).
   * Its promise settles when the cycle it queued has finalized, which only an
   * explicit request may wait for (see `signalInvalidation`).
   */
  onInvalidate?: ExecutorInvalidationCallback;
};

export type BrowserControllerResult = BrowserTestRunResult & {
  watchSession?: BrowserWatchSession;
};

export const runBrowserController = async (
  context: RstestContext,
  options?: BrowserControllerOptions,
): Promise<BrowserControllerResult | void> => {
  const {
    allowEmptyRun = false,
    filesOnly = false,
    onTraceEvents,
    env,
    onInvalidate,
  } = options ?? {};
  const buildStart = Date.now();
  // Watch mode changes what this controller *owns*, never who finalizes: core's
  // `finalizeRunCycle` reduces every cycle on both commands. What watch adds is
  // a persistent runtime (reused across controller re-entry), the rerun
  // triggers, and HMR — so the initial run returns a live watch session instead
  // of a deferred `close`.
  const isWatchMode = context.command === 'watch';

  // Per-file PhaseTrackers, populated only when `--trace` is on (caller
  // passes `onTraceEvents`). The browser host shares one Node process across
  // every test file, so each tracker is assigned a synthetic per-file pid
  // (`nextBrowserFilePid`) that lets Perfetto render each file as its own
  // process track with the file path as the title. Keyed by project + path so
  // concurrent projects running the same file keep separate trackers.
  const phaseTrackers = onTraceEvents
    ? new Map<string, PhaseTracker>()
    : undefined;
  const trackerKey = (project: string, testPath: string) =>
    `${project}\u0000${testPath}`;
  // Explicit projects input (plan output) replaces re-deriving `browser.enabled`
  // projects from `context`, whose `projects` array is mutated during planning.
  // Falls back to re-derivation only when the caller passes no list at all —
  // an explicit empty subset must stay empty, not widen to every project.
  const browserProjects = options?.projects ?? getBrowserProjects(context);
  const useHeadlessDirect = browserProjects.every(
    (project) => project.normalizedConfig.browser.headless,
  );

  const browserSourceMapCache = new Map<string, SourceMapPayload | null>();
  const browserCoverageResources: BrowserV8CoverageResourceStore = {
    assetFiles: new Map(),
    sourceMaps: new Map(),
  };

  const loadBrowserCoverageResources = async (
    filenames: string[],
    resource: keyof BrowserV8CoverageResourceStore,
  ): Promise<Record<string, string>> => {
    const store = browserCoverageResources[resource];
    const loaded: Record<string, string> = {};
    for (const filename of filenames) {
      const value = store.get(filename);
      if (value !== undefined) {
        loaded[filename] = value;
      }
    }
    return loaded;
  };

  const loadBrowserCoverageAssetFiles = (filenames: string[]) =>
    loadBrowserCoverageResources(filenames, 'assetFiles');
  const loadBrowserCoverageSourceMaps = (filenames: string[]) =>
    loadBrowserCoverageResources(filenames, 'sourceMaps');

  const isHttpLikeFile = (file: string): boolean => /^https?:\/\//.test(file);

  const resolveBrowserSourcemap = async (sourcePath: string) => {
    if (!isHttpLikeFile(sourcePath)) {
      return {
        handled: false,
        sourcemap: null,
      };
    }

    const normalizedUrl = normalizeJavaScriptUrl(sourcePath);
    if (!normalizedUrl) {
      return {
        handled: true,
        sourcemap: null,
      };
    }

    if (browserSourceMapCache.has(normalizedUrl)) {
      return {
        handled: true,
        sourcemap: browserSourceMapCache.get(normalizedUrl) ?? null,
      };
    }

    return {
      handled: true,
      sourcemap: await loadSourceMapWithCache({
        jsUrl: normalizedUrl,
        cache: browserSourceMapCache,
      }),
    };
  };

  const getBrowserSourcemap = async (
    sourcePath: string,
  ): Promise<SourceMapPayload | null> => {
    const result = await resolveBrowserSourcemap(sourcePath);
    return result.handled ? result.sourcemap : null;
  };

  /**
   * Build an error BrowserTestRunResult and call onTestRunEnd if needed.
   * Used for early-exit error paths to ensure errors reach the summary report.
   */
  const buildErrorResult = (
    error: Error,
    close?: () => Promise<void>,
  ): BrowserTestRunResult => {
    const elapsed = Math.max(0, Date.now() - buildStart);
    return {
      results: [],
      testResults: [],
      duration: { totalTime: elapsed, buildTime: elapsed, testTime: 0 },
      hasFailure: true,
      unhandledErrors: [error],
      getSourcemap: getBrowserSourcemap,
      resolveSourcemap: resolveBrowserSourcemap,
      close,
    };
  };

  const failWithError = async (
    error: unknown,
    cleanup?: () => Promise<void>,
  ): Promise<BrowserTestRunResult> => {
    // The error rides the returned result into the cycle outcome, and core's
    // `finalizeRunCycle` raises the exit code from it — on both commands.
    const normalizedError = toError(error);

    if (cleanup && !isWatchMode) {
      return buildErrorResult(normalizedError, cleanup);
    }

    try {
      return buildErrorResult(normalizedError);
    } finally {
      await cleanup?.();
    }
  };

  const coverageConfig = browserProjects.find(
    (project) => project.normalizedConfig.coverage?.enabled,
  )?.normalizedConfig.coverage;
  const coverageProvider =
    !filesOnly && context.command !== 'list' && coverageConfig?.enabled
      ? await createCoverageProvider(coverageConfig, context.rootPath)
      : null;
  const browserCoverageCapabilityError =
    !filesOnly &&
    context.command !== 'list' &&
    coverageConfig?.provider === 'v8' &&
    (browserProjects[0]?.normalizedConfig.browser.browser ?? 'chromium') ===
      'chromium' &&
    coverageProvider?.supportsBrowserCoverage !== true
      ? new Error(
          'The installed @rstest/coverage-v8 provider does not support Chromium Browser Mode coverage. ' +
            "Upgrade @rstest/coverage-v8 to the version matching @rstest/core, or use coverage.provider: 'istanbul'.",
        )
      : undefined;

  const containerDevServerEnv = process.env.RSTEST_CONTAINER_DEV_SERVER;
  let containerDevServer: string | undefined;
  let containerDistPath: string | undefined;

  if (!useHeadlessDirect) {
    if (containerDevServerEnv) {
      try {
        containerDevServer = new URL(containerDevServerEnv).toString();
        logger.debug(
          `[Browser UI] Using dev server for container: ${containerDevServer}`,
        );
      } catch (error) {
        const originalError = toError(error);
        originalError.message = `Invalid RSTEST_CONTAINER_DEV_SERVER value: ${originalError.message}`;
        return failWithError(originalError);
      }
    }

    if (!containerDevServer) {
      try {
        containerDistPath = resolveContainerDist();
      } catch (error) {
        return failWithError(error);
      }
    }
  }

  let projectEntries = await resolveProjectEntries(
    context,
    options?.shardedEntries,
    browserProjects,
  );
  let totalTests = projectEntries.reduce(
    (total, item) => total + item.testFiles.length,
    0,
  );
  const shouldInitializeEmptyBrowserHooks =
    totalTests === 0 && hasUserRstestConfigPlugins(browserProjects);

  const createEmptyRunResult = (): BrowserTestRunResult => {
    const elapsed = Math.max(0, Date.now() - buildStart);
    return {
      results: [],
      testResults: [],
      duration: {
        totalTime: elapsed,
        buildTime: elapsed,
        testTime: 0,
      },
      hasFailure: false,
      getSourcemap: getBrowserSourcemap,
      resolveSourcemap: resolveBrowserSourcemap,
    };
  };

  const writeEmptyLaunchExitCode = (): void => {
    context.exitCode.raise(
      resolveEmptyLaunchExitCode(context.exitCode.current, {
        allowEmptyRun,
        isWatchMode,
        passWithNoTests: context.normalizedConfig.passWithNoTests,
      }),
    );
  };

  if (totalTests === 0 && !shouldInitializeEmptyBrowserHooks) {
    writeEmptyLaunchExitCode();
    return allowEmptyRun ? createEmptyRunResult() : undefined;
  }
  const enableCliShortcuts = isWatchMode && isTTY('stdin');
  const browserTempOutputRoot = context.normalizedConfig.output.distPath.root;
  const tempDir =
    isWatchMode && watchContext.runtime
      ? watchContext.runtime.tempDir
      : isWatchMode
        ? join(context.rootPath, browserTempOutputRoot, 'browser', 'watch')
        : join(
            context.rootPath,
            browserTempOutputRoot,
            'browser',
            Date.now().toString(),
          );

  let runtime = isWatchMode ? watchContext.runtime : null;

  const watchSignals = createWatchSignals(onInvalidate);

  if (!runtime) {
    try {
      runtime = await createBrowserRuntime({
        context,
        projectEntries,
        browserProjects,
        shardedEntries: options?.shardedEntries,
        freezeShardedEntries: options?.freezeShardedEntries,
        tempDir,
        isWatchMode,
        containerDistPath,
        containerDevServer,
        skipProviderLaunch:
          filesOnly || Boolean(browserCoverageCapabilityError),
        appliedModifyRstestConfigEnvironments:
          options?.appliedModifyRstestConfigEnvironments,
      });
    } catch (error) {
      return failWithError(error, async () => {
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      });
    }

    // `filesOnly` is the config-hook discovery boot, which destroys its runtime
    // through the returned `close`. Caching it here would leave the real watch
    // session re-entering on a destroyed runtime.
    if (isWatchMode && !filesOnly && !browserCoverageCapabilityError) {
      watchContext.runtime = runtime;
      registerWatchCleanup(context.embedded);
    }
  }

  const watchState = runtime.watchState;

  // Track initial test files for watch mode (from this controller's freshly
  // collected entries, before adopting the runtime's entry snapshot below).
  if (isWatchMode) {
    watchState.lastTestFiles = collectWatchTestFiles(projectEntries);
    // Bind the runtime's long-lived watch plugins to THIS entry's trigger —
    // the runtime survives config-change restarts, this closure does not.
    watchState.triggerRerun = async () => {
      await watchSignals.runDispatchRerun();
    };
  }

  // Mark files as pending-affected so the next trigger reruns them through the
  // normal plan/cycle pipeline (used by explicit rerun requests; omitted paths
  // = all current files). Returns the number of seeded files so a path-scoped
  // request matching no browser test file can skip the rerun entirely (mixed
  // watch 'u' with node-only snapshot updates must produce no browser cycle).
  const seedPendingRerun = (testPaths?: string[]): number => {
    const wanted = testPaths
      ? new Set(testPaths.map((testPath) => normalize(testPath)))
      : null;
    let seeded = 0;
    for (const file of watchState.lastTestFiles) {
      if (wanted && !wanted.has(file.testPath)) {
        continue;
      }
      const pending =
        watchState.pendingAffectedTestFiles.get(file.projectName) ??
        new Set<string>();
      pending.add(file.testPath);
      watchState.pendingAffectedTestFiles.set(file.projectName, pending);
      seeded += 1;
    }
    return seeded;
  };

  /**
   * Fold one watch rerun into the `ExecutorCycleOutcome` core's
   * `finalizeRunCycle` reduces. `context.reporterResults` is the cross-cycle
   * accumulator, so filtering it by the rerun's paths is what makes the outcome
   * cycle-scoped. `buildTime` is the drained duration of the change-triggered
   * compile(s) (zero for a shortcut-driven rerun, which compiles nothing).
   */
  const buildRerunOutcome = ({
    rerunTestPaths,
    testTime,
    rawCoverage,
    unhandledErrors,
  }: {
    rerunTestPaths: string[];
    testTime: number;
    rawCoverage: unknown[];
    unhandledErrors?: Error[];
  }): ExecutorCycleOutcome => {
    const rerunPathSet = new Set(rerunTestPaths);
    const rerunResults = context.reporterResults.results.filter((result) =>
      rerunPathSet.has(result.testPath),
    );
    // Watch coverage is per-cycle on both transports: only the files this
    // rerun executed are reported.
    const coverageMap = buildBrowserCoverageMap(rerunResults, coverageProvider);

    return {
      results: rerunResults,
      testResults: context.reporterResults.testResults.filter((result) =>
        rerunPathSet.has(result.testPath),
      ),
      errors: unhandledErrors ?? [],
      testPaths: rerunTestPaths,
      duration: {
        buildTime: drainPendingBuildTime(watchState),
        testTime,
      },
      coverage:
        coverageMap?.files().length || rawCoverage.length
          ? {
              map: coverageMap?.toJSON(),
              raw: rawCoverage,
              loadAssetFiles: loadBrowserCoverageAssetFiles,
              loadSourceMaps: loadBrowserCoverageSourceMaps,
            }
          : undefined,
      resolveSourcemap: resolveBrowserSourcemap,
    };
  };

  /**
   * The watch session both transports hand back. Only `execute` differs — the
   * cycle's timing, its fatal-error capture window, and the error-to-outcome
   * precedence are one contract with core, so they live in one place.
   *
   * `execute`'s synchronous prefix runs before `runCycle` ever suspends, which
   * is what lets the headed transport claim its cycle scope inside it.
   */
  const createWatchSession = (
    execute: (testPaths: string[]) => Promise<unknown[]>,
  ): BrowserWatchSession => ({
    runCycle: async (testPaths) => {
      const rerunStartTime = Date.now();
      // A fatal error is one cycle's outcome, not permanent session state. The
      // headed scheduler also uses this ref to stop the rest of a failed cycle,
      // so carrying it forward would prevent the next cycle from reloading.
      fatalErrorRef.current = null;
      let rerunError: Error | undefined;
      let rawCoverage: unknown[] = [];

      try {
        rawCoverage = await execute(testPaths);
      } catch (error) {
        // Surfaced through the outcome rather than thrown: core finalizes this
        // cycle either way, and its results belong in the report even when the
        // run that produced them ended badly.
        rerunError = toError(error);
      }

      const rerunFatalError = fatalErrorRef.current ?? undefined;
      return buildRerunOutcome({
        rerunTestPaths: testPaths,
        testTime: Math.max(0, Date.now() - rerunStartTime),
        rawCoverage,
        unhandledErrors: rerunError
          ? [rerunError]
          : rerunFatalError
            ? [rerunFatalError]
            : undefined,
      });
    },
    requestRerun: async (testPaths) => {
      const seeded = seedPendingRerun(testPaths);
      if (testPaths && seeded === 0) {
        return;
      }
      await watchSignals.runDispatchRerun();
      await watchSignals.awaitSignalledCycle();
    },
  });

  projectEntries = runtime.projectEntries;
  totalTests = projectEntries.reduce(
    (total, item) => total + item.testFiles.length,
    0,
  );

  const buildTime = Date.now() - buildStart;

  if (filesOnly) {
    return {
      results: [],
      testResults: [],
      duration: {
        totalTime: buildTime,
        buildTime,
        testTime: 0,
      },
      hasFailure: false,
      getSourcemap: getBrowserSourcemap,
      resolveSourcemap: resolveBrowserSourcemap,
      close: () => destroyBrowserRuntime(runtime),
    };
  }

  if (totalTests === 0) {
    writeEmptyLaunchExitCode();
    await destroyBrowserRuntime(runtime);
    return allowEmptyRun ? createEmptyRunResult() : undefined;
  }
  if (browserCoverageCapabilityError) {
    await destroyBrowserRuntime(runtime);
    return failWithError(browserCoverageCapabilityError);
  }

  const { browser, browserLaunchOptions, wsPort } = runtime;

  // Collect all test files from project entries with project info
  // Normalize paths to posix format for cross-platform compatibility
  const allTestFiles: TestFileInfo[] = projectEntries.flatMap((entry) =>
    entry.testFiles.map((testPath) => ({
      testPath: normalize(testPath),
      projectName: entry.project.name,
    })),
  );

  // Only include browser mode projects in runtime configs
  // Normalize projectRoot to posix format for cross-platform compatibility
  const projectRuntimeConfigs: BrowserProjectRuntime[] = browserProjects.map(
    (project: ProjectContext) => ({
      name: project.name,
      environmentName: project.environmentName,
      projectRoot: normalize(project.rootPath),
      hasSetupFiles: (project.normalizedConfig.setupFiles?.length ?? 0) > 0,
      runtimeConfig: serializableConfig(
        // `env` is the post-globalSetup change-set from the core pre-cycle
        // stage; the projection layers it between the static base and the
        // user `test.env` config.
        projectRuntimeConfig(project, { envMode: 'static', envOverlay: env }),
      ),
      viewport: project.normalizedConfig.browser.viewport,
    }),
  );

  const maxTestTimeoutForRpc = getMaxTestTimeoutForRpc(browserProjects);

  const projectRunnerUrls = Object.fromEntries(
    [...runtime.projectServers].map(([name, server]) => [
      name,
      `http://localhost:${server.port}`,
    ]),
  );
  const containerRunnerUrl = `http://localhost:${runtime.containerServer.port}`;
  const hostOptions: BrowserHostConfig = {
    rootPath: normalize(context.rootPath),
    projects: projectRuntimeConfigs,
    snapshot: {
      updateSnapshot:
        options?.updateSnapshot ??
        context.snapshotManager.options.updateSnapshot,
    },
    // Container origin (fallback). Per-project runner origins below.
    runnerUrl: containerRunnerUrl,
    projectRunnerUrls,
    wsPort,
    debug: isDebug(),
    rpcTimeout: NO_RPC_TIMEOUT,
  };

  const browserProviderProjects: BrowserProviderProject[] = browserProjects.map(
    (project) => ({
      rootPath: normalize(project.rootPath),
      provider: project.normalizedConfig.browser.provider,
    }),
  );
  const implementationByProvider = new Map<
    BrowserProvider,
    BrowserProviderImplementation
  >();
  for (const browserProject of browserProviderProjects) {
    if (!implementationByProvider.has(browserProject.provider)) {
      implementationByProvider.set(
        browserProject.provider,
        getBrowserProviderImplementation(browserProject.provider),
      );
    }
  }

  const browserName = browserLaunchOptions.browser ?? 'chromium';
  const v8CoverageCollector: BrowserV8CoverageCollector | null =
    coverageConfig?.provider === 'v8'
      ? (implementationByProvider
          .get(browserLaunchOptions.provider)
          ?.createV8CoverageCollector?.({ browserName }) ?? null)
      : null;
  const v8Coverage = v8CoverageCollector
    ? {
        start: v8CoverageCollector.start,
        take: (
          page: BrowserProviderPage,
          projectRoot: string,
          projectName?: string,
        ) =>
          takeBrowserV8Coverage({
            collector: v8CoverageCollector,
            fetchTimeout: maxTestTimeoutForRpc,
            page,
            projectUrl:
              projectRunnerUrls[projectName ?? ''] ?? containerRunnerUrl,
            rootPath: normalize(projectRoot),
            sourceMapCache: browserSourceMapCache,
            resourceStore: browserCoverageResources,
          }),
      }
    : undefined;

  let resolveDispatchPages: DispatchPageResolver = () => ({});
  const setDispatchPageResolver = (resolver: DispatchPageResolver): void => {
    resolveDispatchPages = resolver;
  };

  const dispatchBrowserRpcRequest = async ({
    request,
    target,
  }: {
    request: BrowserRpcRequest;
    target?: BrowserDispatchRequest['target'];
  }): Promise<unknown> => {
    const timeoutFallbackMs = maxTestTimeoutForRpc;
    const provider = resolveProviderForTestPath({
      testPath: request.testPath,
      browserProjects: browserProviderProjects,
    });
    const implementation = implementationByProvider.get(provider);
    if (!implementation) {
      throw new Error(`Browser provider implementation not found: ${provider}`);
    }

    const { runnerPage, containerPage } = resolveDispatchPages(target);

    if (target?.sessionId && !runnerPage) {
      throw new Error(
        `Runner page session not found for browser dispatch: ${target.sessionId}`,
      );
    }

    if (!runnerPage && !containerPage) {
      throw new Error('Browser container page is not initialized');
    }

    try {
      return await implementation.dispatchRpc({
        containerPage: runnerPage ? undefined : containerPage,
        runnerPage,
        request,
        timeoutFallbackMs,
      });
    } catch (error) {
      // birpc serializes thrown Errors as `{}` over JSON; throw a string instead.
      if (error instanceof Error) {
        throw error.message;
      }
      throw String(error);
    }
  };

  runtime.dispatchHandlers.set(
    DISPATCH_NAMESPACE_BROWSER,
    async (dispatchRequest) => {
      const request = validateBrowserRpcRequest(dispatchRequest.args);
      return dispatchBrowserRpcRequest({
        request,
        target: dispatchRequest.target,
      });
    },
  );

  runtime.setContainerOptions(hostOptions);

  // Track test results from browser runners
  const reporterResults: TestFileResult[] = [];
  const caseResults: TestResult[] = [];
  const fatalErrorRef = { current: null as Error | null };

  // Runner lifecycle events flow through the shared RunnerEventSink (the same
  // pump the node pool uses), so browser mode feeds stateManager and fans out to
  // reporters via one implementation. One sink is bound per browser project up
  // front from the executor's own project plan (`browserProjects`) — never from
  // `context.projects`, which planning mutates to also contain node projects. The
  // previous lazy resolver fell back to `context.projects[0]`, so a browser event
  // could be attributed to a *node* project's config; binding per browser project
  // here removes that fallback and keeps per-project `onConsoleLog` filtering and
  // `resolveSnapshotPath` correct across browser projects that share a relative
  // test path.
  const runnerSinks = new Map<string, RunnerEventSink>(
    browserProjects.map((project) => [
      project.name,
      createRunnerEventSink(context, project.normalizedConfig),
    ]),
  );
  // Every per-file wire payload carries its owning project name, so routing
  // never derives a project from a test path — concurrent projects can run the
  // same file, and a path-keyed lookup would attribute events to the wrong one.
  // The client resolves its project from the host's own manifest, so a miss is
  // a protocol bug; fail loudly rather than route through another project's
  // config.
  const sinkForProjectName = (projectName: string): RunnerEventSink => {
    const sink = runnerSinks.get(projectName);
    if (!sink) {
      throw new Error(`No runner event sink for project "${projectName}"`);
    }
    return sink;
  };

  // Each project owns its silent-console buffer. Besides preserving each
  // project's config, this keeps concurrent projects that run the same test path
  // from sharing task-id keyed buffered logs. Controllers that are not using
  // `passed-only` never buffer, so lifecycle handlers can flush unconditionally.
  // `writeOriginalLog` is a host-side no-op: page logs have no host "original
  // stream" — the page console and headed terminal forwarding already show them,
  // so re-emitting here would double-print.
  const silentConsoleControllers = new Map<
    string,
    ReturnType<typeof createSilentConsoleController>
  >(
    browserProjects.map((project) => [
      project.name,
      createSilentConsoleController({
        runtimeConfig: {
          silent: project.normalizedConfig.silent,
          disableConsoleIntercept:
            project.normalizedConfig.disableConsoleIntercept,
        },
        emitInterceptedLog: (log) =>
          sinkForProjectName(log.project).onConsoleLog(log),
        writeOriginalLog: () => {},
      }),
    ]),
  );
  const silentConsoleControllerForProjectName = (projectName: string) => {
    const controller = silentConsoleControllers.get(projectName);
    if (!controller) {
      throw new Error(
        `No silent console controller for project "${projectName}"`,
      );
    }
    return controller;
  };

  const snapshotRpcMethods = {
    async resolveSnapshotPath(testPath: string): Promise<string> {
      return resolveSnapshotPathDefault(
        testPath,
        context.normalizedConfig.resolveSnapshotPath,
      );
    },
    async readSnapshotFile(filepath: string): Promise<string | null> {
      try {
        return await fs.readFile(filepath, 'utf-8');
      } catch {
        return null;
      }
    },
    async saveSnapshotFile(filepath: string, content: string): Promise<void> {
      const dir = dirname(filepath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(filepath, content, 'utf-8');
    },
    async removeSnapshotFile(filepath: string): Promise<void> {
      try {
        await fs.unlink(filepath);
      } catch {
        // ignore if file doesn't exist
      }
    },
  };

  const handleTestFileStart = async (
    payload: TestFileStartPayload,
  ): Promise<void> => {
    if (phaseTrackers) {
      const tracker = new PhaseTracker({
        trace: {
          testPath: payload.testPath,
          project: payload.projectName,
        },
        pid: nextBrowserFilePid++,
      });
      tracker.transition('prepare');
      phaseTrackers.set(
        trackerKey(payload.projectName, payload.testPath),
        tracker,
      );
    }
    // The client sends `{ testPath, projectName }`; the sink adapter builds the
    // `TestFileInfo` the reporters and stateManager expect.
    await sinkForProjectName(payload.projectName).onTestFileStart({
      testId: getFileTaskId(payload.testPath),
      testPath: payload.testPath,
      project: payload.projectName,
      tests: [],
    });
  };

  const handleTestFileReady = async (
    payload: TestFileReadyPayload,
  ): Promise<void> => {
    phaseTrackers
      ?.get(trackerKey(payload.project, payload.testPath))
      ?.transition('tests');
    await sinkForProjectName(payload.project).onTestFileReady(payload);
  };

  const handleTestSuiteStart = async (
    payload: TestSuiteStartPayload,
  ): Promise<void> => {
    phaseTrackers
      ?.get(trackerKey(payload.project, payload.testPath))
      ?.recordSuiteStart(payload);
    await sinkForProjectName(payload.project).onTestSuiteStart(payload);
  };

  const handleTestSuiteResult = async (
    payload: TestSuiteResultPayload,
  ): Promise<void> => {
    phaseTrackers
      ?.get(trackerKey(payload.project, payload.testPath))
      ?.recordSuiteResult(payload);
    await sinkForProjectName(payload.project).onTestSuiteResult(payload);

    silentConsoleControllerForProjectName(
      payload.project,
    ).flushBufferedLogsForTask({
      taskId: payload.testId,
      status: payload.status,
      taskParentNames: payload.parentNames,
      taskType: 'suite',
      testPath: payload.testPath,
    });
  };

  const handleTestCaseStart = async (
    payload: TestCaseStartPayload,
  ): Promise<void> => {
    phaseTrackers
      ?.get(trackerKey(payload.project, payload.testPath))
      ?.recordCaseStart(payload);
    // Fire-and-forget on both transports (the sink does not await case-start).
    sinkForProjectName(payload.project).onTestCaseStart(payload);
  };

  const handleTestCaseResult = async (payload: TestResult): Promise<void> => {
    caseResults.push(payload);
    phaseTrackers
      ?.get(trackerKey(payload.project, payload.testPath))
      ?.recordCaseResult(payload);
    await sinkForProjectName(payload.project).onTestCaseResult(payload);

    silentConsoleControllerForProjectName(
      payload.project,
    ).flushBufferedLogsForTask({
      taskId: payload.testId,
      status: payload.status,
      taskParentNames: payload.parentNames,
      taskType: 'case',
      testPath: payload.testPath,
    });
  };

  const handleTestFileComplete = async (
    payload: TestFileResult,
  ): Promise<void> => {
    reporterResults.push(payload);
    context.updateReporterResultState([payload], payload.results);

    if (phaseTrackers) {
      const key = trackerKey(payload.project, payload.testPath);
      const tracker = phaseTrackers.get(key);
      if (tracker) {
        tracker.end();
        const events = tracker.getTraceEvents();
        if (events) onTraceEvents?.(events);
        phaseTrackers.delete(key);
      }
    }

    silentConsoleControllerForProjectName(
      payload.project,
    ).flushBufferedLogsForTask({
      taskId: payload.testId,
      status: payload.status,
      taskParentNames: payload.parentNames,
      taskType: 'file',
      testPath: payload.testPath,
    });

    // Feeds stateManager, fans out onTestFileResult to reporters, and ingests
    // payload.snapshotResult (the snapshotManager.add moved into the sink).
    await sinkForProjectName(payload.project).onTestFileResult(payload);
  };

  const handleLog = async (payload: LogPayload): Promise<void> => {
    const log: UserConsoleLog = {
      content: payload.content,
      // Same colored level label as the node worker's CustomConsole.
      name: getPrettyConsoleName(payload.level),
      taskId: payload.taskId,
      taskName: payload.taskName,
      taskParentNames: payload.taskParentNames,
      taskType: payload.taskType,
      testPath: payload.testPath,
      project: payload.projectName,
      type: payload.type,
      trace: payload.trace,
    };
    silentConsoleControllerForProjectName(payload.projectName).onConsoleLog(
      log,
    );
  };

  // Every failing file and every fatal error reaches core through the cycle
  // outcome on both commands, so the exit code keeps a single writer:
  // `finalizeRunCycle`.
  const handleFatal = async (payload: FatalPayload): Promise<void> => {
    const error = new Error(payload.message);
    error.stack = payload.stack;
    fatalErrorRef.current = error;
  };

  const runSnapshotRpc = async (
    request: SnapshotRpcRequest,
  ): Promise<unknown> => {
    switch (request.method) {
      case 'resolveSnapshotPath':
        return snapshotRpcMethods.resolveSnapshotPath(request.args.testPath);
      case 'readSnapshotFile':
        return snapshotRpcMethods.readSnapshotFile(request.args.filepath);
      case 'saveSnapshotFile':
        return snapshotRpcMethods.saveSnapshotFile(
          request.args.filepath,
          request.args.content,
        );
      case 'removeSnapshotFile':
        return snapshotRpcMethods.removeSnapshotFile(request.args.filepath);
      default: {
        // Exhaustiveness guard: a new SnapshotRpcRequest method without a case
        // here fails to compile rather than silently returning undefined.
        const _exhaustive: never = request;
        return _exhaustive;
      }
    }
  };

  const createDispatchRouter = (options?: HostDispatchRouterOptions) => {
    return createHostDispatchRouter({
      routerOptions: options,
      runnerCallbacks: {
        onTestFileStart: handleTestFileStart,
        onTestFileReady: handleTestFileReady,
        onTestSuiteStart: handleTestSuiteStart,
        onTestSuiteResult: handleTestSuiteResult,
        onTestCaseStart: handleTestCaseStart,
        onTestCaseResult: handleTestCaseResult,
        onTestFileComplete: handleTestFileComplete,
        onLog: handleLog,
        onFatal: handleFatal,
      },
      runSnapshotRpc,
      extensionHandlers: runtime.dispatchHandlers,
      onDuplicateNamespace: (namespace) => {
        logger.debug(
          `[Dispatch] Skip registering dispatch namespace "${namespace}" because it is already reserved`,
        );
      },
    });
  };

  const schedulerDeps = {
    context,
    allTestFiles,
    hostOptions,
    projectRoots: new Map(
      projectRuntimeConfigs.map((project) => [
        project.name,
        project.projectRoot,
      ]),
    ),
    isWatchMode,
    createDispatchRouter,
    fatalErrorRef,
    watchSignals,
    setDispatchPageResolver,
    createWatchSession,
    collectProjectEntries: () => collectProjectEntries(context),
    logWatchReady: () => logWatchReadyMessage(context, enableCliShortcuts),
    destroyRuntime: () => destroyBrowserRuntime(runtime),
  };

  const { testTime, rawCoverage, watchSession, close } = useHeadlessDirect
    ? await createHeadlessScheduler({
        ...schedulerDeps,
        browser,
        browserLaunchOptions,
        projectServers: runtime.projectServers,
        v8Coverage,
        projectRuntimeConfigs,
        watchState,
        handlers: { handleFatal, handleTestFileComplete },
      })
    : await createHeadedScheduler({
        ...schedulerDeps,
        runtime,
        v8Coverage,
        handlers: { handleTestFileComplete },
      });

  // The first build must not trigger a duplicate cycle, but a fatal test cycle
  // does not invalidate the session the scheduler already established.
  watchState.hooksEnabled = watchSession !== undefined;

  // A fatal error the run reported outranks its results: it rides the returned
  // outcome into core's finalize, which raises the exit code from it.
  if (fatalErrorRef.current) {
    const errorResult = await failWithError(fatalErrorRef.current, close);
    return {
      ...errorResult,
      rawCoverage,
      loadAssetFiles: loadBrowserCoverageAssetFiles,
      loadSourceMaps: loadBrowserCoverageSourceMaps,
      watchSession,
    };
  }

  context.updateReporterResultState(reporterResults, caseResults);

  return {
    results: reporterResults,
    testResults: caseResults,
    duration: {
      totalTime: buildTime + testTime,
      buildTime,
      testTime,
    },
    hasFailure: reporterResults.some(
      (result: TestFileResult) => result.status === 'fail',
    ),
    rawCoverage,
    loadAssetFiles: loadBrowserCoverageAssetFiles,
    loadSourceMaps: loadBrowserCoverageSourceMaps,
    getSourcemap: getBrowserSourcemap,
    resolveSourcemap: resolveBrowserSourcemap,
    // `close` is already `undefined` in watch mode: the watch runtime outlives
    // the cycle and is torn down through `executor.close()`.
    close,
    watchSession,
  };
};
// ============================================================================
// List Browser Tests
// ============================================================================

/**
 * Result from collecting browser tests.
 * This is the return type for listBrowserTests, designed for future extraction
 * to a separate browser package.
 */
export type ListBrowserTestsResult = {
  list: ListCommandResult[];
  close: () => Promise<void>;
};

/**
 * Collect test metadata from browser mode projects without running them.
 * This function creates a headless browser runtime, loads test files,
 * and collects their test structure (describe/test declarations).
 */
export const listBrowserTests = async (
  context: RstestContext,
  options?: ListBrowserTestsOptions,
): Promise<ListBrowserTestsResult> => {
  const browserProjects = options?.projects ?? getBrowserProjects(context);
  const projectEntries = await resolveProjectEntries(
    context,
    options?.shardedEntries,
    browserProjects,
  );
  const totalTests = projectEntries.reduce(
    (total, item) => total + item.testFiles.length,
    0,
  );

  if (totalTests === 0 && !hasUserRstestConfigPlugins(browserProjects)) {
    return {
      list: [],
      close: async () => {},
    };
  }

  const tempDir = join(
    context.rootPath,
    context.normalizedConfig.output.distPath.root,
    'browser',
    `list-${Date.now()}`,
  );

  // Create a simplified browser runtime for collect mode
  let runtime: BrowserRuntime;
  try {
    runtime = await createBrowserRuntime({
      context,
      projectEntries,
      browserProjects,
      shardedEntries: options?.shardedEntries,
      freezeShardedEntries: options?.freezeShardedEntries,
      tempDir,
      isWatchMode: false,
      containerDistPath: undefined,
      containerDevServer: undefined,
      forceHeadless: true, // Always use headless for list command
      skipProviderLaunch: options?.filesOnly,
      appliedModifyRstestConfigEnvironments:
        options?.appliedModifyRstestConfigEnvironments,
    });
  } catch (error) {
    const providers = [
      ...new Set(
        browserProjects.map((p) => p.normalizedConfig.browser.provider),
      ),
    ];
    logger.error(
      color.red(
        `Failed to initialize browser provider runtime (${providers.join(', ')}).`,
      ),
      error,
    );
    throw error;
  }

  if (options?.filesOnly) {
    const list = runtime.projectEntries.flatMap((entry) =>
      entry.testFiles.map((testPath) => ({
        testPath,
        project: entry.project.name,
        tests: [],
      })),
    );
    await destroyBrowserRuntime(runtime);
    return {
      list,
      close: async () => {},
    };
  }

  if (!runtime.projectEntries.some((entry) => entry.testFiles.length > 0)) {
    await destroyBrowserRuntime(runtime);
    return {
      list: [],
      close: async () => {},
    };
  }

  const { browser, browserLaunchOptions } = runtime;

  // Get browser projects for runtime config
  // Normalize projectRoot to posix format for cross-platform compatibility
  const projectRuntimeConfigs: BrowserProjectRuntime[] = browserProjects.map(
    (project: ProjectContext) => ({
      name: project.name,
      environmentName: project.environmentName,
      projectRoot: normalize(project.rootPath),
      hasSetupFiles: (project.normalizedConfig.setupFiles?.length ?? 0) > 0,
      runtimeConfig: serializableConfig(
        projectRuntimeConfig(project, {
          envMode: 'static',
          envOverlay: options?.env,
        }),
      ),
      viewport: project.normalizedConfig.browser.viewport,
    }),
  );

  const hostOptions: BrowserHostConfig = {
    rootPath: normalize(context.rootPath),
    projects: projectRuntimeConfigs,
    snapshot: {
      updateSnapshot: context.snapshotManager.options.updateSnapshot,
    },
    mode: 'collect', // Use collect mode
    debug: isDebug(),
    rpcTimeout: NO_RPC_TIMEOUT,
  };

  runtime.setContainerOptions(hostOptions);

  // Collect results across every project's isolated dev server. Each server
  // serves only its own project's manifest, so collection navigates one page
  // per project; each page returns its own results, aggregated afterwards.
  const browserContext = await browser.newContext({
    providerOptions: browserLaunchOptions.providerOptions,
    viewport: null,
  });

  const serializedOptions = serializeForInlineScript(hostOptions);

  // Per-page collect watchdog: a test file whose module evaluation stalls must
  // not hang `rstest list` forever.
  const collectTimeoutMs = 30_000;

  const collectFromServer = async (
    server: BrowserProjectServer,
  ): Promise<{ results: ListCommandResult[]; error: Error | null }> => {
    const results: ListCommandResult[] = [];
    let error: Error | null = null;
    let collectCompleted = false;
    let resolveCollect: (() => void) | undefined;
    const collectPromise = new Promise<void>((resolve) => {
      resolveCollect = resolve;
    });

    const page = await browserContext.newPage();

    // Expose dispatch function for browser client to send messages. The runner
    // stamps its run identity beside every message; collection ignores it (a
    // collect page is navigated directly, so there is no lease to check) and
    // reads the message the envelope carries.
    await page.exposeFunction(
      DISPATCH_MESSAGE_TYPE,
      (envelope: RunnerEnvelope) => {
        const message = envelope.message;
        switch (message.type) {
          case 'collect-result': {
            const payload = message.payload;
            results.push({
              testPath: payload.testPath,
              project: payload.project,
              tests: payload.tests,
            });
            break;
          }
          case 'collect-complete':
            collectCompleted = true;
            resolveCollect?.();
            break;
          case 'fatal': {
            const payload = message.payload;
            error = new Error(payload.message);
            error.stack = payload.stack;
            resolveCollect?.();
            break;
          }
          case 'ready':
          case 'log':
            // Ignore these messages during collection
            break;
          default:
            // Log unexpected messages for debugging
            logger.debug(`[List] Unexpected message: ${message.type}`);
        }
      },
    );

    // Inject host options before navigation so the runner can access them
    await page.addInitScript(
      `window.__RSTEST_BROWSER_OPTIONS__ = ${serializedOptions};`,
    );

    // Navigate to this project's runner page
    await page.goto(`http://localhost:${server.port}/runner.html`, {
      waitUntil: 'load',
    });

    // Wait for collection to complete with the shared collect timeout.
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<void>((resolve) => {
      timeoutId = setTimeout(() => {
        if (!collectCompleted) {
          logger.warn(
            color.yellow(
              `[List] Browser test collection timed out after ${collectTimeoutMs}ms`,
            ),
          );
        }
        resolve();
      }, collectTimeoutMs);
    });

    await Promise.race([collectPromise, timeoutPromise]);

    // Clear timeout to prevent Node.js from waiting for it
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    await page.close().catch(() => {});
    return { results, error };
  };

  // Collect every project concurrently — each navigates its own page against
  // its own dev server and returns its own results.
  const collected = await Promise.all(
    [...runtime.projectServers.values()].map((server) =>
      collectFromServer(server),
    ),
  );
  const collectResults = collected.flatMap((entry) => entry.results);
  const fatalError = collected.find((entry) => entry.error)?.error ?? null;

  // Cleanup
  const cleanup = async () => {
    try {
      await browserContext.close();
    } catch {
      // ignore
    }
    await destroyBrowserRuntime(runtime);
  };

  if (fatalError) {
    await cleanup();
    // Return error in the result format instead of throwing
    const errorResult: ListCommandResult = {
      testPath: '',
      project: '',
      tests: [],
      errors: [
        {
          name: 'BrowserCollectError',
          message: fatalError.message,
          stack: fatalError.stack,
        } as FormattedError,
      ],
    };
    return {
      list: [errorResult],
      close: async () => {},
    };
  }

  return {
    list: collectResults,
    close: cleanup,
  };
};
