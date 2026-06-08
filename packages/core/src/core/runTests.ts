import { constants as osConstants } from 'node:os';
import { cleanCoverageReports, createCoverageProvider } from '../coverage';
import { ensureRunDependencies } from './dependencies';
import { createPool } from '../pool';
import type {
  Duration,
  ProjectContext,
  ProjectEntries,
  SourceMapInput,
  TestFileResult,
  TestResult,
} from '../types';
import type { CoverageMap, CoverageProvider } from '../types/coverage';
import {
  clearScreen,
  color,
  createTraceController,
  getTestEntries,
  getForceRerunTriggerMessage,
  getNoTestFilesMessage,
  isDebug,
  flushOutputStreams,
  logger,
  mergeDurations,
  resolveShardedEntries,
  type TraceEvent,
  type TraceRun,
} from '../utils';
import {
  type BrowserTestRunOptions,
  type BrowserTestRunResult,
  loadBrowserModule,
} from './browserLoader';
import { isCliShortcutsEnabled, setupCliShortcuts } from './cliShortcuts';
import { kindOf, type TestExecutor } from './executor';
import { runGlobalTeardown } from './globalSetup';
import { createNodeExecutor } from './nodeExecutor';
import { createRsbuildServer, prepareRsbuild } from './rsbuild';
import type { Rstest } from './rstest';

/**
 * Load the browser module for the given projects and run its version gate +
 * `validateBrowserConfig` before any export is used. Both browser entry points
 * (`runBrowserTests` and `createExecutorFactory`) go through here so the
 * load/validate sequence stays single-sourced.
 */
async function loadValidatedBrowserModule(
  context: Rstest,
  browserProjects: typeof context.projects,
): Promise<Awaited<ReturnType<typeof loadBrowserModule>>> {
  const projectRoots = browserProjects.map((p) => p.rootPath);
  const mod = await loadBrowserModule({
    projectRoots,
    embedded: context.embedded,
  });
  mod.validateBrowserConfig(context);
  return mod;
}

/**
 * Run browser mode tests.
 * Returns the result for unified reporter output.
 */
async function runBrowserModeTests(
  context: Rstest,
  browserProjects: typeof context.projects,
  options: BrowserTestRunOptions,
): Promise<BrowserTestRunResult | void> {
  const { runBrowserTests } = await loadValidatedBrowserModule(
    context,
    browserProjects,
  );
  return runBrowserTests(context, options);
}

/**
 * Load and construct the browser {@link TestExecutor}. The version gate and
 * `validateBrowserConfig` run in {@link loadValidatedBrowserModule} before the
 * factory's `create()` is reached.
 */
async function createBrowserExecutor(
  context: Rstest,
  browserProjects: typeof context.projects,
): Promise<TestExecutor> {
  const { createExecutorFactory } = await loadValidatedBrowserModule(
    context,
    browserProjects,
  );
  return createExecutorFactory().create({ context });
}

/**
 * Collect the browser test entry file paths up front so the run can populate
 * `stateManager.testFiles` before the host fans `onTestFileResult` — the verbose
 * reporter reads `getTestFiles()?.length === 1` during execution to decide
 * single-file case expansion (matching node, which sets `testFiles` in `run()`).
 * Mirrors the host's own entry collection so the count agrees with what runs.
 */
async function collectBrowserEntryFiles(
  context: Rstest,
  browserProjects: typeof context.projects,
): Promise<string[]> {
  const perProject = await Promise.all(
    browserProjects.map(async (project) => {
      const { include, exclude, includeSource } = project.normalizedConfig;
      const entries = await getTestEntries({
        include,
        exclude: exclude.patterns,
        includeSource,
        rootPath: context.rootPath,
        projectRoot: project.rootPath,
        fileFilters: context.fileFilters || [],
        fileFilterMode: context.fileFilterMode,
      });
      return Object.values(entries);
    }),
  );
  return perProject.flat();
}

const getSignalExitCode = (signal: NodeJS.Signals): number => {
  const signalNumber = osConstants.signals[signal];
  return typeof signalNumber === 'number' ? 128 + signalNumber : 1;
};

const reportNoTestFiles = ({
  context,
  mode = 'all',
}: {
  context: Rstest;
  mode?: 'all' | 'on-demand';
}) => {
  if (context.command === 'watch') {
    if (mode === 'on-demand') {
      logger.log(color.yellow('No test files need re-run.'));
    } else {
      logger.log(color.yellow('No test files found.'));
    }
  } else {
    const code = context.normalizedConfig.passWithNoTests ? 0 : 1;
    const message = getNoTestFilesMessage({
      context,
      code,
      defaultMessage: `No test files found, exiting with code ${code}.`,
    });

    if (code === 0) {
      logger.log(color.yellow(message));
    } else {
      logger.error(color.red(message));
    }

    // `process.exitCode` mutations here (and in deeper layers such as
    // globalSetup teardown, coverage threshold checks) are restored to their
    // pre-run value by `runRstest` in the embedded path via try/finally, so
    // we don't need to gate them per-call site.
    process.exitCode = code;
  }

  if (mode === 'all') {
    if (context.relatedFilters?.length) {
      logger.log(
        color.gray('related: '),
        context.relatedFilters.join(color.gray(', ')),
      );
    } else if (context.fileFilters?.length) {
      logger.log(
        color.gray('filter: '),
        context.fileFilters.join(color.gray(', ')),
      );
    }

    context.projects.forEach((p) => {
      if (context.projects.length > 1) {
        logger.log('');
        logger.log(color.gray('project:'), p.name);
      }
      logger.log(color.gray('root:'), p.rootPath);

      logger.log(
        color.gray('include:'),
        p.normalizedConfig.include.join(color.gray(', ')),
      );
      logger.log(
        color.gray('exclude:'),
        p.normalizedConfig.exclude.patterns.join(color.gray(', ')),
      );
    });
  }
};

const notifyReportersOnTestRunEnd = async ({
  context,
  coverage,
  duration,
  getSourcemap,
  unhandledErrors,
  filterRerunTestPaths,
}: {
  context: Rstest;
  coverage?: CoverageMap;
  duration: Duration;
  getSourcemap: (sourcePath: string) => Promise<SourceMapInput | null>;
  unhandledErrors?: Error[];
  filterRerunTestPaths?: string[];
}) => {
  for (const reporter of context.reporters) {
    await reporter.onTestRunEnd?.({
      results: context.reporterResults.results,
      coverage: coverage?.toJSON(),
      testResults: context.reporterResults.testResults,
      unhandledErrors,
      snapshotSummary: context.snapshotManager.summary,
      duration,
      getSourcemap,
      filterRerunTestPaths,
    });
    if (reporter.flushOutputStreams !== false) {
      await flushOutputStreams();
    }
  }
};

const isLifecycleDebugEnabled = isDebug();

const runLifecycleStep = async <T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T> => {
  if (!isLifecycleDebugEnabled) {
    return fn();
  }

  const startTime = Date.now();
  logger.debug(`lifecycle: start ${label}`);

  try {
    const result = await fn();
    logger.debug(`lifecycle: finish ${label} (${Date.now() - startTime}ms)`);
    return result;
  } catch (error) {
    logger.debug(`lifecycle: fail ${label} (${Date.now() - startTime}ms)`);
    throw error;
  }
};

/**
 * The single core-driven finalize for a non-watch run (and each node watch
 * rerun): derive the verdict, sink the results into the reporter state, fire the
 * one `onTestRunEnd`, and generate the one coverage report. Both the browser-only
 * run and the node/mixed `run()` call this, so `notifyReportersOnTestRunEnd` and
 * `generateCoverage` each have a single reachable call site in non-watch mode —
 * the bypass finalize paths cannot silently regrow. (The browser-only WATCH path
 * still self-finalizes inside the host until RFC phase 5.)
 *
 * Callers pre-reduce their executor results (concat results, sum durations, union
 * ran paths) and pass an already-built `getSourcemap`; the divergent bits — the
 * sourcemap resolver chain (browser-only vs browser-first-then-node) and the
 * coverage scope (`scheduledProjects`) — stay in the callers, not here.
 */
const finalizeRun = async ({
  context,
  results,
  testResults,
  unhandledErrors,
  deletedEntries,
  duration,
  ranTestPaths,
  getSourcemap,
  mergedCoverageMap,
  coverageProvider,
  scheduledProjects,
  traceRun,
  mode,
}: {
  context: Rstest;
  results: TestFileResult[];
  testResults: TestResult[];
  unhandledErrors: Error[];
  deletedEntries: string[];
  duration: Duration;
  ranTestPaths: string[];
  getSourcemap: (sourcePath: string) => Promise<SourceMapInput | null>;
  mergedCoverageMap: CoverageMap | undefined;
  coverageProvider: CoverageProvider | null;
  /** Projects whose env was built this round — scopes untested-file coverage. */
  scheduledProjects: ProjectContext[];
  traceRun: TraceRun;
  mode?: 'all' | 'on-demand';
}): Promise<{ isFailure: boolean }> => {
  const isFailure =
    results.some((r) => r.status === 'fail') || unhandledErrors.length > 0;
  const noTestsDiscovered =
    results.length === 0 && unhandledErrors.length === 0;

  context.updateReporterResultState(results, testResults, deletedEntries);

  if (noTestsDiscovered) {
    reportNoTestFiles({ context, mode });
  }

  if (isFailure) {
    process.exitCode = 1;
  }

  await runLifecycleStep('reporter onTestRunEnd', () =>
    notifyReportersOnTestRunEnd({
      context,
      coverage: mergedCoverageMap,
      duration,
      getSourcemap,
      unhandledErrors,
      filterRerunTestPaths: ranTestPaths.length ? ranTestPaths : undefined,
    }),
  );

  const { coverage } = context.normalizedConfig;
  if (coverageProvider && (!isFailure || coverage.reportOnFailure)) {
    const { generateCoverage } = await import('../coverage/generate');
    await runLifecycleStep('coverage report generation', () =>
      generateCoverage(
        scheduledProjects,
        context,
        mergedCoverageMap!,
        coverageProvider,
        traceRun.span,
      ),
    );
  }

  await runLifecycleStep('trace run finalize', () => traceRun.finalize());

  return { isFailure };
};

export async function runTests(context: Rstest): Promise<void> {
  cleanCoverageReports(context.normalizedConfig.coverage);

  if (context.relatedRerunReason === 'forceRerunTrigger') {
    logger.log(`${color.yellow(getForceRerunTriggerMessage(context))}\n`);
  }

  // Separate browser mode and node mode projects
  const browserProjects = context.projects.filter(
    (project) => kindOf(project) === 'browser',
  );
  const nodeProjects = context.projects.filter(
    (project) => kindOf(project) === 'node',
  );

  const hasBrowserProjects = browserProjects.length > 0;
  const hasNodeProjects = nodeProjects.length > 0;

  const isWatchMode = context.command === 'watch';

  // For non-watch mode with both browser and node tests, we need to unify reporter output
  const shouldUnifyReporter =
    !isWatchMode && hasBrowserProjects && hasNodeProjects;

  // Constructed before the browser-only fast path so `--trace` is honored
  // for pure-browser runs (browser host forwards events via `onTraceEvents`).
  const traceController = createTraceController({
    enabled: context.trace,
    rootPath: context.rootPath,
  });

  // Browser-only: the non-watch run flows through the same `run()` finalize as
  // node via the browser TestExecutor (one `onTestRunEnd`, one coverage map,
  // one verdict). Watch keeps the host self-finalize path until the watch
  // unification (RFC phase 5).
  if (hasBrowserProjects && !hasNodeProjects) {
    if (isWatchMode) {
      if (context.relatedResolutionEmpty) {
        await runBrowserModeTests(context, browserProjects, {
          skipOnTestRunEnd: false,
          allowEmptyWatchRun: true,
        });
        await runLifecycleStep('trace controller cleanup', () =>
          traceController.close(),
        );
        return;
      }

      const { coverage } = context.normalizedConfig;

      await ensureRunDependencies({
        projects: [],
        rootPath: context.rootPath,
        coverage,
      });

      if (coverage.enabled) {
        logger.log(
          ` ${color.gray('Coverage enabled with')} %s\n`,
          color.yellow(coverage.provider),
        );
      }

      const traceRun = traceController.beginRun();

      const browserResult = await runBrowserModeTests(
        context,
        browserProjects,
        {
          skipOnTestRunEnd: false,
          onTraceEvents: traceRun.onEvents,
        },
      );

      // Watch keeps the host self-finalize coverage path: the host reported
      // reporter coverage via its own `onTestRunEnd`; here we generate the
      // report files for the initial run. This weaker guard is preserved for
      // watch only — the non-watch path below uses the unified node guard.
      if (
        coverage.enabled &&
        browserResult?.results.length &&
        !browserResult.unhandledErrors?.length
      ) {
        const coverageProvider = await createCoverageProvider(
          coverage,
          context.rootPath,
        );
        if (coverageProvider) {
          const browserCoverageMap = coverageProvider.createCoverageMap();
          for (const result of browserResult.results) {
            if (result.coverage) {
              browserCoverageMap.merge(result.coverage);
            }
          }
          const { generateCoverage } = await import('../coverage/generate');
          // Browser-only path: every project is a browser project here
          // (`!hasNodeProjects`), so `browserProjects === context.projects`.
          await generateCoverage(
            browserProjects,
            context,
            browserCoverageMap,
            coverageProvider,
            traceRun.span,
          );
        }
      }

      await runLifecycleStep('trace shutdown', () =>
        traceController.shutdown(traceRun),
      );
      return;
    }

    // Non-watch browser-only — unified core finalize via the browser executor.
    const { coverage } = context.normalizedConfig;

    await ensureRunDependencies({
      projects: [],
      rootPath: context.rootPath,
      coverage,
    });

    if (coverage.enabled) {
      logger.log(
        ` ${color.gray('Coverage enabled with')} %s\n`,
        color.yellow(coverage.provider),
      );
    }

    const coverageProvider = coverage.enabled
      ? await createCoverageProvider(coverage, context.rootPath)
      : null;

    const browserExecutor = await createBrowserExecutor(
      context,
      browserProjects,
    );

    // Populate `stateManager.testFiles` before execution so the verbose reporter
    // expands cases for a single-file run exactly like node. Skip when related
    // resolution is empty (no files run; the executor returns empty).
    const browserEntryFiles = context.relatedResolutionEmpty
      ? []
      : await collectBrowserEntryFiles(context, browserProjects);

    for (const reporter of context.reporters) {
      await reporter.onTestRunStart?.();
    }

    context.stateManager.reset();
    context.stateManager.testFiles = browserEntryFiles;

    const mergedCoverageMap: CoverageMap | undefined = coverageProvider
      ? coverageProvider.createCoverageMap()
      : undefined;

    const traceRun = traceController.beginRun();

    try {
      const runResult = await browserExecutor.runTests({
        projects: browserProjects,
        mode: 'all',
        fileFilters: context.fileFilters,
        buildStart: Date.now(),
        onCoverageResult: (cov) => mergedCoverageMap?.merge(cov),
        onTraceEvents: traceRun.onEvents,
        traceSpan: traceRun.span,
      });

      const getSourcemap = async (
        sourcePath: string,
      ): Promise<SourceMapInput | null> => {
        const resolved = await runResult.resolveSourcemap?.(sourcePath);
        return resolved?.sourcemap ?? null;
      };

      await finalizeRun({
        context,
        results: runResult.results,
        testResults: runResult.testResults,
        unhandledErrors: runResult.unhandledErrors,
        deletedEntries: runResult.deletedEntries,
        duration: runResult.duration,
        ranTestPaths: runResult.ranTestPaths,
        getSourcemap,
        mergedCoverageMap,
        coverageProvider,
        // Browser-only: every project is a browser project, and its env was
        // built this round, so it is the coverage scope.
        scheduledProjects: browserProjects,
        traceRun,
      });
    } finally {
      await runLifecycleStep('browser result cleanup', () =>
        browserExecutor.close(),
      );
    }

    // Mirrors node's non-watch teardown (`traceRun.finalize()` above, then
    // `waitForExit()`). No trailing `traceController.close()`: when `--trace` is
    // on, `waitForExit()` is a `Promise<never>` that blocks until the user's
    // SIGINT calls `process.exit()`, so a `close()` after it is unreachable;
    // when `--trace` is off it is a no-op. Either way it is byte-identical.
    await runLifecycleStep('trace wait for exit', () =>
      traceController.waitForExit(),
    );
    return;
  }

  // If only node tests, run them (handled below)
  // If both, run them in parallel

  let browserResultPromise: Promise<BrowserTestRunResult | void> | undefined;
  // Late-binding handoff for mixed-mode browser+node runs: the browser host
  // is launched once at the top of `runTests`, but each call to `run()`
  // starts a fresh per-rerun trace buffer. Pre-allocate the first buffer
  // here so events emitted before `run()` adopts it — or in scenarios where
  // `run()` is never called (mixed mode with all node tests filtered out) —
  // are not silently dropped. `beginRun` itself returns a no-op handle when
  // tracing is disabled, so we can keep `activeTraceRun` non-optional.
  let activeTraceRun = traceController.beginRun();
  const forwardBrowserTraceEvents = context.trace
    ? (events: TraceEvent[]) => activeTraceRun.onEvents?.(events)
    : undefined;

  const allProjects = context.projects;

  const { rootPath, reporters, snapshotManager, command, normalizedConfig } =
    context;
  const { coverage, shard } = normalizedConfig;

  const entriesCache: Map<string, ProjectEntries> =
    (await resolveShardedEntries(context)) || new Map();

  // Define globTestSourceEntries after entriesCache is potentially populated
  const globTestSourceEntries = async (
    name: string,
  ): Promise<Record<string, string>> => {
    if (context.relatedResolutionEmpty) {
      return {};
    }
    if (!isWatchMode && shard && entriesCache.has(name)) {
      return entriesCache.get(name)!.entries;
    }
    const { include, exclude, includeSource, root } = allProjects.find(
      (p) => p.environmentName === name,
    )!.normalizedConfig;
    const entries = await getTestEntries({
      include,
      exclude: exclude.patterns,
      includeSource,
      rootPath,
      projectRoot: root,
      fileFilters: context.fileFilters || [],
      fileFilterMode: context.fileFilterMode,
    });

    entriesCache.set(name, {
      entries,
      fileFilters: context.fileFilters,
    });

    return entries;
  };

  let browserProjectsToRun = browserProjects;
  let nodeProjectsToRun = nodeProjects;

  // In non-watch mode, proactively skip projects with no test files to avoid unnecessary builds
  if (!isWatchMode) {
    // Populate entries cache for all projects
    await Promise.all(
      allProjects.map((p) => globTestSourceEntries(p.environmentName)),
    );

    const hasEntries = (env: string) =>
      Object.keys(entriesCache.get(env)?.entries || {}).length > 0;

    browserProjectsToRun = browserProjects.filter((p) =>
      hasEntries(p.environmentName),
    );
    nodeProjectsToRun = nodeProjects.filter((p) =>
      hasEntries(p.environmentName),
    );
  } else if (shard) {
    // In watch mode with sharding, only run projects that have sharded entries
    browserProjectsToRun = browserProjects.filter((p) => {
      return (
        Object.keys(entriesCache.get(p.environmentName)?.entries || {}).length >
        0
      );
    });
    nodeProjectsToRun = nodeProjects.filter((p) => {
      return (
        Object.keys(entriesCache.get(p.environmentName)?.entries || {}).length >
        0
      );
    });
  }

  if (isWatchMode && context.relatedResolutionEmpty) {
    browserProjectsToRun = browserProjects;
    nodeProjectsToRun = [];
  }

  const hasBrowserTestsToRun = browserProjectsToRun.length > 0;
  const hasNodeTestsToRun = nodeProjectsToRun.length > 0;

  if (hasNodeTestsToRun || hasBrowserTestsToRun) {
    await ensureRunDependencies({
      projects: nodeProjectsToRun,
      rootPath,
      coverage,
    });
  }

  // If there are browser tests to run, start them.
  if (hasBrowserTestsToRun) {
    const browserEntries = new Map();
    if (shard) {
      for (const p of browserProjectsToRun) {
        browserEntries.set(
          p.environmentName,
          entriesCache.get(p.environmentName),
        );
      }
    }
    browserResultPromise = runBrowserModeTests(context, browserProjectsToRun, {
      // In a non-watch mixed run the browser defers its teardown + reporting to
      // the unified `run()` finalize. The early return below is gated to watch
      // only, so non-watch always reaches `run()` even when node resolves to
      // zero files — which both closes #1363 (one unified `onTestRunEnd`) and
      // supersedes the interim `&& hasNodeTestsToRun` hang-guard from #1386:
      // with `run()` always reached, the deferred browser is always torn down.
      skipOnTestRunEnd: shouldUnifyReporter,
      shardedEntries: shard ? browserEntries : undefined,
      allowEmptyWatchRun: isWatchMode && context.relatedResolutionEmpty,
      onTraceEvents: forwardBrowserTraceEvents,
    });

    // Prevent an unhandled rejection window in mixed node+browser runs.
    // We still await the original promise later to surface the error.
    browserResultPromise.catch(() => undefined);
  }

  // Watch keeps the early return: in watch the browser host self-finalizes its
  // own reporters (skipOnTestRunEnd is false) and drives its own reruns, so a
  // node-empty watch round exits here after flushing trace. In non-watch we
  // deliberately fall through to the unified `run()` finalize even with no node
  // tests left — a filtered-mixed run (node matched zero files, browser has
  // tests) then emits exactly one `onTestRunEnd` and one coverage report instead
  // of zero, closing the deferred #1363 gap.
  if (isWatchMode && !hasNodeTestsToRun) {
    if (browserResultPromise) {
      await browserResultPromise;
    }
    if (hasBrowserTestsToRun) {
      // `run()` is not invoked on this watch path, so flush any browser trace
      // events the host emitted into the pre-allocated buffer before exiting.
      await runLifecycleStep('trace shutdown', () =>
        traceController.shutdown(activeTraceRun),
      );
      return;
    }
  }

  // The `projects` variable now refers to node projects that have tests to run.
  const projects = nodeProjectsToRun;

  const { getSetupFiles } = await import('../utils/getSetupFiles');

  const setupFiles = Object.fromEntries(
    projects.map((project) => {
      const {
        environmentName,
        rootPath,
        normalizedConfig: { setupFiles },
      } = project;

      return [environmentName, getSetupFiles(setupFiles, rootPath)];
    }),
  );

  const globalSetupFiles = Object.fromEntries(
    // Global setup still applies to all original projects in context
    context.projects.map((project) => {
      const {
        environmentName,
        rootPath,
        normalizedConfig: { globalSetup },
      } = project;

      return [environmentName, getSetupFiles(globalSetup, rootPath)];
    }),
  );

  const rsbuildInstance = await prepareRsbuild(
    context,
    globTestSourceEntries,
    setupFiles,
    globalSetupFiles,
    projects,
  );

  const { getRsbuildStats, closeServer } = await createRsbuildServer({
    inspectedConfig: {
      ...context.normalizedConfig,
      // Pass only the relevant node projects for Rsbuild processing
      projects: projects.map((p) => p.normalizedConfig),
    },
    isWatchMode,
    globTestSourceEntries,
    setupFiles,
    globalSetupFiles,
    rsbuildInstance,
    rootPath,
  });

  const entryFiles = Array.from(entriesCache.values()).reduce<string[]>(
    (acc, entry) => acc.concat(Object.values(entry.entries) || []),
    [],
  );

  const getRecommendWorkerCount = (): number => {
    // TODO: the best way is to create workers on demand
    const nodeEntries = Array.from(entriesCache.entries()).filter(([key]) => {
      const project = projects.find((p) => p.environmentName === key);
      return !project || kindOf(project) === 'node';
    });

    return nodeEntries.flatMap(
      ([_key, entry]) => Object.values(entry.entries) || [],
    ).length;
  };

  const recommendWorkerCount =
    command === 'watch' ? Number.POSITIVE_INFINITY : getRecommendWorkerCount();

  const pool = await createPool({
    context,
    recommendWorkerCount,
  });

  const nodeExecutor = createNodeExecutor({
    context,
    pool,
    getRsbuildStats,
  });

  // Initialize coverage collector
  const coverageProvider = coverage.enabled
    ? await createCoverageProvider(coverage, context.rootPath)
    : null;

  if (coverageProvider) {
    logger.log(
      ` ${color.gray('Coverage enabled with')} %s\n`,
      color.yellow(coverage.provider),
    );
  }

  type Mode = 'all' | 'on-demand';

  const run = async ({
    fileFilters,
    mode = 'all',
    buildStart = Date.now(),
  }: {
    fileFilters?: string[];
    mode?: Mode;
    buildStart?: number;
  } = {}) => {
    for (const reporter of reporters) {
      await reporter.onTestRunStart?.();
    }

    context.stateManager.reset();

    // TODO: this is not the best practice for collecting test files
    context.stateManager.testFiles = isWatchMode ? undefined : entryFiles;

    const mergedCoverageMap: CoverageMap | undefined = coverageProvider
      ? coverageProvider.createCoverageMap()
      : undefined;

    // Adopt the pre-allocated buffer (set above `runTests` or at the end of
    // the previous rerun's `finalize`) so browser events emitted before
    // `run()` are captured.
    const traceRun = activeTraceRun;
    // `span` is a transparent pass-through when tracing is disabled
    // (see `beginRun` in utils/trace.ts), so call sites stay branch-free.
    const { span } = traceRun;

    const nodeResult = await nodeExecutor.runTests({
      projects,
      mode,
      fileFilters,
      buildStart,
      onCoverageResult: (coverage) => mergedCoverageMap?.merge(coverage),
      onTraceEvents: traceRun.onEvents,
      traceSpan: span,
    });

    // Wait for browser tests to complete if running in parallel
    const browserResult = browserResultPromise
      ? await browserResultPromise
      : undefined;
    const browserResolveSourcemap = browserResult?.resolveSourcemap;
    const browserClose = browserResult?.close;

    try {
      const getSourcemap = async (
        sourcePath: string,
      ): Promise<SourceMapInput | null> => {
        if (browserResolveSourcemap) {
          const resolved = await browserResolveSourcemap(sourcePath);
          if (resolved.handled) {
            return resolved.sourcemap;
          }
        }

        const resolved = await nodeResult.resolveSourcemap?.(sourcePath);
        return resolved?.sourcemap ?? null;
      };

      // In non-watch mixed runs the browser result is merged into the node
      // verdict for one unified finalize. In watch the browser self-finalizes
      // (own reporters + reruns), so its results are never merged here —
      // preserved until the watch unification (RFC phase 5).
      const unifyBrowser = shouldUnifyReporter && Boolean(browserResult);

      // The node executor returns freshly-allocated, single-owner arrays, so the
      // node-only path reuses them as-is; only the unify path builds new arrays.
      let results = nodeResult.results;
      let testResults = nodeResult.testResults;
      let errors = nodeResult.unhandledErrors;
      let ranTestPaths = nodeResult.ranTestPaths;
      let duration = nodeResult.duration;

      if (unifyBrowser && browserResult) {
        // Strip coverage from browser results into the one merged map, mirroring
        // the node-side pool layer's `delete result.coverage`.
        for (const r of browserResult.results) {
          if (r.coverage) {
            mergedCoverageMap?.merge(r.coverage);
            delete r.coverage;
          }
        }
        results = [...results, ...browserResult.results];
        testResults = [...testResults, ...(browserResult.testResults ?? [])];
        if (browserResult.unhandledErrors) {
          errors = [...errors, ...browserResult.unhandledErrors];
        }
        // Union ran paths so the failing-tests summary keeps browser failures —
        // node-only `filterRerunTestPaths` would otherwise filter them out.
        ranTestPaths = [
          ...ranTestPaths,
          ...browserResult.results.map((r) => r.testPath),
        ];
        // Combine browser and node durations for the unified reporter output.
        duration = mergeDurations([
          nodeResult.duration,
          browserResult.duration,
        ]);
      }

      // Browser project envs are built this round in the host's own Rsbuild, so
      // include them in the coverage scope. Required for a node-empty mixed run:
      // with `coverage.include` set, the include-filter would otherwise drop the
      // browser project's files from the report.
      const scheduledProjects = unifyBrowser
        ? [...projects, ...browserProjectsToRun]
        : projects;

      const { isFailure } = await finalizeRun({
        context,
        results,
        testResults,
        unhandledErrors: errors,
        deletedEntries: nodeResult.deletedEntries,
        duration,
        ranTestPaths,
        getSourcemap,
        mergedCoverageMap,
        coverageProvider,
        scheduledProjects,
        traceRun,
        mode,
      });

      // Pre-allocate the next watch-rerun buffer so browser events emitted
      // between reruns (or before the next `run()` adopts a fresh buffer)
      // are not lost.
      activeTraceRun = traceController.beginRun();

      if (isFailure) {
        const bail = context.normalizedConfig.bail;

        if (bail && context.stateManager.getCountOfFailedTests() >= bail) {
          logger.log(
            color.yellow(
              `Test run aborted due to reaching the bail limit of ${bail} failed test(s).`,
            ),
          );
        }
      }
    } finally {
      if (browserClose) {
        await runLifecycleStep('browser result cleanup', () => browserClose());
      }
    }
  };

  if (command === 'watch') {
    const enableCliShortcuts = isCliShortcutsEnabled();

    let isCleaningUp = false;

    const cleanup = async () => {
      if (isCleaningUp) {
        return;
      }
      isCleaningUp = true;

      try {
        await runLifecycleStep('global teardown', () => runGlobalTeardown());
        await runLifecycleStep('worker pool cleanup', () =>
          nodeExecutor.close(),
        );
        await runLifecycleStep('rsbuild server cleanup', () => closeServer());
        // Flush any browser events the host pushed into the pre-allocated
        // buffer since the last `run()` finalized — otherwise they get
        // dropped when the controller closes. Inline (not `shutdown`)
        // because cleanup may run from a SIGINT handler and `waitForExit`
        // would block waiting for another signal.
        await runLifecycleStep('trace run finalize', () =>
          activeTraceRun.finalize(),
        );
        await runLifecycleStep('trace controller cleanup', () =>
          traceController.close(),
        );
      } catch (error) {
        logger.log(color.red(`Error during cleanup: ${error}`));
      }
    };

    const handleSignal = async (signal: NodeJS.Signals) => {
      logger.log(color.yellow(`\nReceived ${signal}, cleaning up...`));
      await cleanup();
      // Exit with appropriate code (128 + signal number is Unix convention)
      process.exit(getSignalExitCode(signal));
    };

    // In embedded (programmatic) mode the caller owns process lifecycle and
    // signal routing, so we skip installing host-process handlers.
    if (!context.embedded) {
      process.on('SIGINT', handleSignal);
      process.on('SIGTERM', handleSignal);
      process.on('SIGTSTP', handleSignal);
    }

    const afterTestsWatchRun = () => {
      logger.log(color.green('  Waiting for file changes...'));

      if (enableCliShortcuts) {
        if (snapshotManager.summary.unmatched) {
          // highlight `u` when there are unmatched snapshots
          logger.log(
            `  ${color.dim('press')} ${color.yellow(color.bold('u'))} ${color.dim('to update snapshot')}${color.dim(', press')} ${color.bold('h')} ${color.dim('to show help')}\n`,
          );
        } else {
          logger.log(
            `  ${color.dim('press')} ${color.bold('h')} ${color.dim('to show help')}${color.dim(', press')} ${color.bold('q')} ${color.dim('to quit')}\n`,
          );
        }
      }
    };

    const { onBeforeRestart } = await import('./restart');

    onBeforeRestart(async () => {
      await runLifecycleStep('global teardown', () => runGlobalTeardown());
      await runLifecycleStep('worker pool cleanup', () => nodeExecutor.close());
      await runLifecycleStep('rsbuild server cleanup', () => closeServer());
      await runLifecycleStep('trace run finalize', () =>
        activeTraceRun.finalize(),
      );
      await runLifecycleStep('trace controller cleanup', () =>
        traceController.close(),
      );
    });

    let buildStart: number | undefined;

    rsbuildInstance.onBeforeDevCompile(({ isFirstCompile }) => {
      buildStart = Date.now();
      if (!isFirstCompile) {
        clearScreen();
      }
    });

    rsbuildInstance.onAfterDevCompile(async ({ isFirstCompile }) => {
      snapshotManager.clear();
      await run({ buildStart, mode: isFirstCompile ? 'all' : 'on-demand' });
      buildStart = undefined;

      if (isFirstCompile && enableCliShortcuts) {
        const closeCliShortcuts = await setupCliShortcuts({
          closeServer: async () => {
            await runLifecycleStep('worker pool cleanup', () =>
              nodeExecutor.close(),
            );
            await runLifecycleStep('rsbuild server cleanup', () =>
              closeServer(),
            );
            await runLifecycleStep('trace run finalize', () =>
              activeTraceRun.finalize(),
            );
            await runLifecycleStep('trace controller cleanup', () =>
              traceController.close(),
            );
          },
          runAll: async () => {
            clearScreen();
            snapshotManager.clear();
            context.normalizedConfig.testNamePattern = undefined;
            context.fileFilters = undefined;

            // TODO: should rerun compile with new entries
            await run({ mode: 'all' });
            afterTestsWatchRun();
          },
          runWithTestNamePattern: async (pattern?: string) => {
            clearScreen();
            // Update testNamePattern for current run
            context.normalizedConfig.testNamePattern = pattern;

            if (pattern) {
              logger.log(
                `\n${color.dim('Applied testNamePattern:')} ${color.bold(pattern)}\n`,
              );
            } else {
              logger.log(`\n${color.dim('Cleared testNamePattern filter')}\n`);
            }
            snapshotManager.clear();
            await run();
            afterTestsWatchRun();
          },
          runWithFileFilters: async (filters?: string[]) => {
            clearScreen();
            if (filters && filters.length > 0) {
              logger.log(
                `\n${color.dim('Applied file filters:')} ${color.bold(filters.join(', '))}\n`,
              );
            } else {
              logger.log(`\n${color.dim('Cleared file filters')}\n`);
            }
            snapshotManager.clear();
            context.fileFilters = filters;
            const entries = await Promise.all(
              projects.map(async (p) => {
                return globTestSourceEntries(p.environmentName);
              }),
            ).then((entries) =>
              entries.reduce<string[]>(
                (acc, entry) => acc.concat(...Object.values(entry)),
                [],
              ),
            );

            if (!entries.length) {
              logger.log(
                filters
                  ? color.yellow(
                      `\nNo matching test files to run with current file filters: ${filters.join(',')}\n`,
                    )
                  : color.yellow('\nNo matching test files to run.\n'),
              );
              return;
            }
            await run({ fileFilters: entries });
            afterTestsWatchRun();
          },
          runFailedTests: async () => {
            const failedTests = context.reporterResults.results
              .filter((result) => result.status === 'fail')
              .map((r) => r.testPath);

            if (!failedTests.length) {
              logger.log(
                color.yellow(
                  '\nNo failed tests were found that needed to be rerun.',
                ),
              );
              return;
            }

            clearScreen();

            snapshotManager.clear();

            await run({ fileFilters: failedTests, mode: 'all' });
            afterTestsWatchRun();
          },
          updateSnapshot: async () => {
            if (!snapshotManager.summary.unmatched) {
              logger.log(
                color.yellow(
                  '\nNo snapshots were found that needed to be updated.',
                ),
              );
              return;
            }
            const failedTests = context.reporterResults.results
              .filter((result) => result.snapshotResult?.unmatched)
              .map((r) => r.testPath);

            clearScreen();

            const originalUpdateSnapshot =
              snapshotManager.options.updateSnapshot;
            snapshotManager.clear();
            snapshotManager.options.updateSnapshot = 'all';
            await run({ fileFilters: failedTests });
            afterTestsWatchRun();
            snapshotManager.options.updateSnapshot = originalUpdateSnapshot;
          },
        });

        onBeforeRestart(closeCliShortcuts);
      }

      afterTestsWatchRun();
    });
  } else {
    let isTeardown = false;
    let isCleaningUp = false;

    const cleanup = async () => {
      if (isCleaningUp) {
        return;
      }
      isCleaningUp = true;

      try {
        await runLifecycleStep('global teardown', () => runGlobalTeardown());
        await runLifecycleStep('worker pool cleanup', () =>
          nodeExecutor.close(),
        );
        await runLifecycleStep('rsbuild server cleanup', () => closeServer());
        await runLifecycleStep('trace run finalize', () =>
          activeTraceRun.finalize(),
        );
        await runLifecycleStep('trace controller cleanup', () =>
          traceController.close(),
        );
      } catch (error) {
        logger.log(color.red(`Error during cleanup: ${error}`));
      }
    };

    const unExpectedExit = (code?: number) => {
      if (isTeardown) {
        logger.log(
          color.yellow(
            `Rstest exited unexpectedly with code ${code}, this is likely caused by test environment teardown.`,
          ),
        );
      } else {
        logger.log(
          color.red(
            `Rstest exited unexpectedly with code ${code}, terminating test run.`,
          ),
        );

        // Run global teardown before exit
        runGlobalTeardown().catch((error) => {
          logger.log(color.red(`Error in global teardown: ${error}`));
        });

        process.exitCode = 1;
      }
    };

    const handleSignal = async (signal: NodeJS.Signals) => {
      logger.log(color.yellow(`\nReceived ${signal}, cleaning up...`));
      await cleanup();
      // Exit with appropriate code (128 + signal number is Unix convention)
      process.exit(getSignalExitCode(signal));
    };

    // In embedded (programmatic) mode the caller owns process lifecycle and
    // signal routing, so we skip installing host-process handlers.
    if (!context.embedded) {
      process.on('exit', unExpectedExit);
      process.on('SIGINT', handleSignal);
      process.on('SIGTERM', handleSignal);
      process.on('SIGTSTP', handleSignal);
    }

    try {
      await run();
      isTeardown = true;
      await runLifecycleStep('worker pool cleanup', () => nodeExecutor.close());
      await runLifecycleStep('rsbuild server cleanup', () => closeServer());

      // Run global teardown after all tests are done
      await runLifecycleStep('global teardown', () => runGlobalTeardown());
    } catch (error) {
      // In embedded (programmatic) mode the caller's process keeps running, so
      // release the worker pool, Rsbuild server, and run global teardown here
      // when `run()` (or a post-run step) throws — otherwise they leak into the
      // host. `cleanup()` is idempotent, so this won't double-close on the happy
      // path. The CLI path relies on process exit + its `exit` handler instead.
      if (context.embedded) {
        await cleanup();
      }
      throw error;
    } finally {
      if (!context.embedded) {
        process.off('exit', unExpectedExit);
        process.off('SIGINT', handleSignal);
        process.off('SIGTERM', handleSignal);
        process.off('SIGTSTP', handleSignal);
      }
    }

    await runLifecycleStep('trace wait for exit', () =>
      traceController.waitForExit(),
    );
  }
}
