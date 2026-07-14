import { constants as osConstants } from 'node:os';
import { isAbsolute, normalize, relative, resolve } from 'pathe';
import { cleanCoverageReports, createCoverageProvider } from '../coverage';
import { ensureRunDependencies } from './dependencies';
import { ensureTestEnvironmentDependencies } from './envDependencies';
import { createPool } from '../pool';
import type {
  EntryInfo,
  ExecutorCycleOutcome,
  ProjectContext,
  TestFileResult,
} from '../types';
import type { CoverageMap, CoverageProvider } from '../types/coverage';
import {
  clearScreen,
  color,
  createTraceController,
  getForceRerunTriggerMessage,
  logger,
  type TraceEvent,
  type TraceRun,
} from '../utils';
import {
  finalizeRunCycle,
  notifyReportersOnTestRunEnd,
  notifyReportersOnTestRunStart,
  reportNoTestFiles,
  runLifecycleStep,
} from './finalizeRun';
import {
  type BrowserTestRunOptions,
  type BrowserTestRunResult,
  loadBrowserModule,
} from './browserLoader';
import { isCliShortcutsEnabled, setupCliShortcuts } from './cliShortcuts';
import {
  claimGlobalSetupOnce,
  runGlobalSetup,
  runGlobalTeardown,
} from './globalSetup';
import { createSetupFileState } from './setupFileState';
import { createRsbuildServer, prepareRsbuild } from './rsbuild';
import {
  readResultsCache,
  sequenceKey,
  writeResultsCache,
} from './resultsCache';
import { applyOnlyFailuresSelection } from './onlyFailures';
import { type SequenceHints, sortTestEntries } from './testSequencer';
import { createRunProjectPlanState, syncNodeProjects } from './projectPlan';
import type { Rstest } from './rstest';
import { prepareWatchRerunState } from './watchState';
import { getUserRstestConfigPluginProjects } from './modifyRstestConfig';

/**
 * Run browser mode tests.
 * Returns the result for unified reporter output.
 */
async function runBrowserModeTests(
  context: Rstest,
  browserProjects: typeof context.projects,
  options: BrowserTestRunOptions,
): Promise<BrowserTestRunResult | void> {
  const projectRoots = browserProjects.map((p) => p.rootPath);
  const { validateBrowserConfig, runBrowserTests } = await loadBrowserModule({
    projectRoots,
    embedded: context.embedded,
  });
  validateBrowserConfig(context);
  return runBrowserTests(context, options);
}

const getSignalExitCode = (signal: NodeJS.Signals): number => {
  const signalNumber = osConstants.signals[signal];
  return typeof signalNumber === 'number' ? 128 + signalNumber : 1;
};

/**
 * Merge the browser host's per-file `result.coverage` into one map, stripping it
 * from each result to avoid reporter/state cache bloat. Returns the map (node
 * results, by contrast, are stripped at the pool boundary and merged there);
 * callers that feed the outcome's coverage channel `.toJSON()` it.
 */
function buildBrowserCoverageMap(
  results: TestFileResult[],
  coverageProvider: CoverageProvider | null,
): CoverageMap | undefined {
  const map = coverageProvider?.createCoverageMap();
  for (const result of results) {
    if (result.coverage) {
      map?.merge(result.coverage);
      delete result.coverage;
    }
  }
  return map;
}

/**
 * Adapt a browser host result into the shared {@link ExecutorCycleOutcome} so
 * the browser-only non-watch and mixed paths hand `finalizeRunCycle` identical
 * outcomes.
 */
function toBrowserOutcome(
  browserResult: BrowserTestRunResult,
  coverageProvider: CoverageProvider | null,
): ExecutorCycleOutcome {
  return {
    results: browserResult.results,
    testResults: browserResult.testResults,
    errors: browserResult.unhandledErrors ?? [],
    testPaths: browserResult.results.map((r) => r.testPath),
    duration: {
      buildTime: browserResult.duration.buildTime,
      testTime: browserResult.duration.testTime,
    },
    coverage: {
      map: buildBrowserCoverageMap(
        browserResult.results,
        coverageProvider,
      )?.toJSON(),
    },
    resolveSourcemap: browserResult.resolveSourcemap,
  };
}

/**
 * Create the coverage provider when coverage is enabled and print the
 * `Coverage enabled with <provider>` banner once. Returns null when disabled.
 */
async function createCoverageProviderWithLog(
  context: Rstest,
  enabled: boolean,
): Promise<CoverageProvider | null> {
  if (!enabled) {
    return null;
  }
  const { coverage } = context.normalizedConfig;
  const coverageProvider = await createCoverageProvider(
    coverage,
    context.rootPath,
  );
  if (coverageProvider) {
    logger.log(
      ` ${color.gray('Coverage enabled with')} %s\n`,
      color.yellow(coverage.provider),
    );
  }
  return coverageProvider;
}

/**
 * Reduce an awaited browser host result through the shared finalize and tear
 * the browser down in a single `finally` — after finalize's coverage report, so
 * the RFC ordering invariant holds and no thrown finalize can leak the browser
 * and hang the process. The browser-only non-watch and #1363 (mixed run whose
 * node projects resolved to zero files) paths share this exact shape, differing
 * only in how they obtain `browserResult` and which trace buffer they feed.
 */
async function finalizeBrowserRun(
  context: Rstest,
  browserResult: BrowserTestRunResult | void,
  {
    coverageProvider,
    reportOnFailure,
    traceRun,
  }: {
    coverageProvider: CoverageProvider | null;
    reportOnFailure: boolean;
    traceRun: TraceRun;
  },
): Promise<void> {
  try {
    const outcomes: ExecutorCycleOutcome[] = browserResult
      ? [toBrowserOutcome(browserResult, coverageProvider)]
      : [];
    await finalizeRunCycle(context, {
      outcomes,
      mode: 'all',
      // Watch runs never reach this finalize path: the browser host owns the
      // watch lifecycle, so every caller here is a non-watch run.
      isWatchMode: false,
      coverageProvider,
      reportOnFailure,
      traceRun,
      currentDeletedEntries: [],
    });
  } finally {
    if (browserResult?.close) {
      await runLifecycleStep('browser result cleanup', () =>
        browserResult.close!(),
      );
    }
  }
}

export async function runTests(context: Rstest): Promise<void> {
  // High-level flow:
  // 1. Split browser and node projects. Pure-browser runs take a fast path
  //    because they do not need Rsbuild's node-side server or worker pool.
  // 2. Resolve runnable projects before preparing Rsbuild. This also scans
  //    file-level environment comments and splits node projects by their final
  //    `testEnvironment`, so each Rsbuild environment is present before
  //    environment-scoped plugins initialize.
  // 3. Prepare Rsbuild with the pre-grouped node environments; let server
  //    creation drive config resolution so run mode avoids extra initConfigs
  //    side effects.
  // 4. For node or mixed runs, create the Rsbuild dev server to trigger config
  //    hooks, validate node environment dependencies, then start browser tests
  //    for mixed runs and initialize the node worker pool.
  // 5. The inner `run()` handles one compile cycle: read Rsbuild stats, run
  //    global setup, execute workers, merge browser/node results for reporters,
  //    generate coverage, and finalize trace data.
  // 6. Watch mode wires `run()` to Rsbuild rebuild callbacks and CLI shortcuts;
  //    non-watch mode calls it once and then tears everything down.
  cleanCoverageReports(context.normalizedConfig.coverage);

  if (context.relatedRerunReason === 'forceRerunTrigger') {
    logger.log(`${color.yellow(getForceRerunTriggerMessage(context))}\n`);
  }

  // Separate browser mode and node mode projects
  const browserProjects = context.projects.filter(
    (project) => project.normalizedConfig.browser.enabled,
  );
  const nodeProjects = context.projects.filter(
    (project) => !project.normalizedConfig.browser.enabled,
  );

  const hasBrowserProjects = browserProjects.length > 0;
  const hasNodeProjects = nodeProjects.length > 0;

  const isWatchMode = context.command === 'watch';

  // Reset the per-run test state once, before any executor starts streaming
  // events into `stateManager`. A non-watch run is a single cycle, so we reset
  // here — ahead of the browser-only fast path and the mixed browser/node
  // run — instead of inside `run()`. Now that browser events flow through the
  // shared `RunnerEventSink` into `stateManager`, a reset inside `run()` would
  // wipe browser events that the floating promise already streamed. Watch reruns
  // own their own reset via `prepareWatchRerunState` at each rerun trigger.
  if (!isWatchMode) {
    context.stateManager.reset();
  }

  // `onlyFailures` applies only to a plain, full run: any other scoping
  // mechanism wins over failure history. Watch has its own run-failed shortcut
  // and refreshes the failed set as you edit. `--changed`/`--related` scope by
  // relevance to a change — and their forceRerunTriggers path deliberately
  // clears all file filters to force a full-suite rerun, which failure
  // selection must not narrow back down. Explicit file filters are the user
  // naming exactly what to run. Warn once and ignore (rather than erroring) so
  // a shared config carrying `onlyFailures` stays usable everywhere.
  if (context.normalizedConfig.onlyFailures) {
    if (isWatchMode) {
      logger.warn(
        'onlyFailures is ignored in watch mode; use the watch run-failed shortcut instead.',
      );
    } else if (context.relatedMode) {
      logger.warn(
        `onlyFailures is ignored when combined with --${context.relatedMode}.`,
      );
    } else if (context.fileFilters?.length) {
      logger.warn(
        'onlyFailures is ignored when explicit file filters are provided.',
      );
    } else if (context.normalizedConfig.testNamePattern) {
      logger.warn(
        'onlyFailures is ignored when a test name pattern is provided.',
      );
    }
  }

  // For non-watch mode with both browser and node tests, we need to unify reporter output
  const shouldUnifyReporter =
    !isWatchMode && hasBrowserProjects && hasNodeProjects;
  const getEmptyRunDuration = () => ({
    totalTime: 0,
    buildTime: 0,
    testTime: 0,
  });

  // Constructed before the browser-only fast path so `--trace` is honored
  // for pure-browser runs (browser host forwards events via `onTraceEvents`).
  const traceController = createTraceController({
    enabled: context.trace,
    rootPath: context.rootPath,
  });

  // If only browser tests, run them and generate coverage
  if (hasBrowserProjects && !hasNodeProjects) {
    if (context.relatedResolutionEmpty) {
      if (isWatchMode) {
        await runBrowserModeTests(context, browserProjects, {
          allowEmptyWatchRun: true,
        });
      } else {
        reportNoTestFiles({ context });
        await notifyReportersOnTestRunEnd({
          context,
          duration: getEmptyRunDuration(),
          getSourcemap: async () => null,
        });
      }

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

    if (isWatchMode) {
      // Browser-only watch: the host owns per-rerun finalize (unchanged). The
      // bespoke coverage report runs once after the watch session exits.
      const browserResult = await runBrowserModeTests(
        context,
        browserProjects,
        {
          onTraceEvents: traceRun.onEvents,
        },
      );

      if (
        coverage.enabled &&
        browserResult?.results.length &&
        !browserResult.unhandledErrors?.length
      ) {
        const coverageProvider = await createCoverageProvider(
          coverage,
          context.rootPath,
        );
        const browserCoverageMap = buildBrowserCoverageMap(
          browserResult.results,
          coverageProvider,
        );
        if (coverageProvider && browserCoverageMap) {
          const { generateCoverage } = await import('../coverage/generate');
          await generateCoverage(
            context,
            browserCoverageMap,
            coverageProvider,
            traceRun.span,
          );
        }
      }
    } else {
      // Browser-only non-watch: the host defers its own onTestRunEnd and returns
      // an outcome that the shared finalizeRunCycle reduces — so exit code,
      // reporter output, coverage, and the no-test path match node and mixed
      // runs. A no-test run comes back as a void result → empty outcomes →
      // core's reportNoTestFiles.
      const coverageProvider = coverage.enabled
        ? await createCoverageProvider(coverage, context.rootPath)
        : null;

      // The host defers the run-level reporter hooks to the caller in non-watch
      // mode; emit `onTestRunStart` here (the shared finalizeRunCycle emits the
      // matching `onTestRunEnd`), mirroring `run()`.
      await notifyReportersOnTestRunStart(context);

      const browserResult = await runBrowserModeTests(
        context,
        browserProjects,
        {
          onTraceEvents: traceRun.onEvents,
        },
      );

      await finalizeBrowserRun(context, browserResult, {
        coverageProvider,
        reportOnFailure: coverage.reportOnFailure,
        traceRun,
      });
    }

    await runLifecycleStep('trace shutdown', () =>
      traceController.shutdown(traceRun),
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

  const { rootPath, snapshotManager, command, normalizedConfig } = context;
  const { coverage, shard } = normalizedConfig;

  const isFilterInsideProject = (filter: string, project: ProjectContext) => {
    const absoluteFilter = normalize(
      isAbsolute(filter) ? filter : resolve(rootPath, filter),
    );
    const relativeFilter = normalize(
      relative(project.rootPath, absoluteFilter),
    );

    return (
      relativeFilter === '' ||
      (!relativeFilter.startsWith('..') && !isAbsolute(relativeFilter))
    );
  };

  const isFuzzyBasenameFilter = (filter: string) => {
    if (context.fileFilterMode === 'exact' || isAbsolute(filter)) {
      return false;
    }

    const normalizedFilter = normalize(filter);
    return (
      !normalizedFilter.startsWith('.') &&
      !normalizedFilter.includes('/') &&
      !normalizedFilter.includes('\\')
    );
  };

  const isBrowserProjectPathFilter = (filter: string) =>
    !isFuzzyBasenameFilter(filter) &&
    browserProjects.some((project) => isFilterInsideProject(filter, project));

  const isNodeProjectPathFilter = (filter: string) =>
    !isFuzzyBasenameFilter(filter) &&
    nodeProjects.some((project) => isFilterInsideProject(filter, project));

  const browserConfigHookProjects =
    getUserRstestConfigPluginProjects(browserProjects);

  const setupFileState = createSetupFileState();
  const appliedBrowserModifyRstestConfigEnvironments = new Set<string>();
  let hasRunBrowserConfigHookDiscovery = false;
  const projectPlanState = createRunProjectPlanState({
    context,
    browserProjects,
    isWatchMode,
  });
  const {
    globTestSourceEntries,
    resolveRunnableProjects,
    validateEnvironmentComments,
  } = projectPlanState;
  let plan = await resolveRunnableProjects({ silentShardMessage: true });
  const plannedNodeSourceNames = new Set(
    plan.nodeProjectsToRun.map(
      (project) =>
        project._environmentGroup?.sourceEnvironmentName ??
        project.environmentName,
    ),
  );
  const rsbuildProjects = [
    ...plan.nodeProjectsToRun,
    ...nodeProjects.filter(
      (project) => !plannedNodeSourceNames.has(project.environmentName),
    ),
  ];
  context.projects = [...browserProjects, ...rsbuildProjects];

  let coveragePluginLoadError: unknown;

  const rsbuildInstance = await prepareRsbuild({
    context,
    globTestSourceEntries,
    setupFileState,
    targetProjects: rsbuildProjects,
    onCoveragePluginLoadError: (error) => {
      coveragePluginLoadError = error;
    },
    getSetupFileProjects: () => ({
      setupProjects: projectPlanState.getPlan().nodeProjectsToRun,
      globalSetupProjects: context.projects,
    }),
    onModifyRstestConfigApplied: async () => {
      plan = await resolveRunnableProjects({ strictEnvironmentComments: true });
      syncNodeProjects(rsbuildProjects, plan.nodeProjectsToRun);
    },
    onRsbuildConfigResolved: validateEnvironmentComments,
  });

  const shouldRunBrowserDiscoveryFallback = () => {
    if (
      browserConfigHookProjects.length === 0 ||
      context.relatedResolutionEmpty ||
      hasRunBrowserConfigHookDiscovery
    ) {
      return false;
    }

    if (!context.fileFilters?.length) {
      return true;
    }

    return context.fileFilters.some(
      (filter) =>
        isFuzzyBasenameFilter(filter) ||
        browserConfigHookProjects.some((project) =>
          isFilterInsideProject(filter, project),
        ) ||
        (!isBrowserProjectPathFilter(filter) &&
          !isNodeProjectPathFilter(filter)),
    );
  };

  const shouldAllowEmptyBrowserFallback = () =>
    shouldRunBrowserDiscoveryFallback() &&
    hasNodeTestsToRun &&
    !context.fileFilters?.some(isBrowserProjectPathFilter);

  const getBrowserProjectsForDiscovery = () => {
    if (!context.fileFilters?.length) {
      return browserConfigHookProjects;
    }

    if (context.fileFilters.some(isFuzzyBasenameFilter)) {
      return browserConfigHookProjects;
    }

    const matchedProjects = browserConfigHookProjects.filter((project) =>
      context.fileFilters?.some((filter) =>
        isFilterInsideProject(filter, project),
      ),
    );
    if (matchedProjects.length > 0) {
      return matchedProjects;
    }

    return context.fileFilters.some(
      (filter) =>
        !isBrowserProjectPathFilter(filter) && !isNodeProjectPathFilter(filter),
    )
      ? browserConfigHookProjects
      : [];
  };

  const getBrowserProjectsToRun = () => {
    const currentPlan = projectPlanState.getPlan();
    if (currentPlan.browserProjectsToRun.length > 0) {
      return currentPlan.browserProjectsToRun;
    }

    return getBrowserProjectsForDiscovery();
  };

  const getBrowserShardedEntries = (
    projects: ProjectContext[],
  ): Map<string, { entries: Record<string, string> }> | undefined => {
    if (!shard) {
      return undefined;
    }
    const currentPlan = projectPlanState.getPlan();
    const browserEntries = new Map<
      string,
      { entries: Record<string, string> }
    >();
    for (const project of projects) {
      const entries = currentPlan.entriesCache.get(project.environmentName);
      if (entries) {
        browserEntries.set(project.environmentName, entries);
      }
    }
    return browserEntries;
  };

  const syncRunPlanFlags = () => {
    const currentPlan = projectPlanState.getPlan();
    return {
      hasBrowserTestsToRun:
        currentPlan.browserProjectsToRun.length > 0 ||
        shouldRunBrowserDiscoveryFallback(),
      hasNodeTestsToRun: currentPlan.nodeProjectsToRun.length > 0,
    };
  };

  let { hasBrowserTestsToRun, hasNodeTestsToRun } = syncRunPlanFlags();

  if (hasNodeProjects && shouldRunBrowserDiscoveryFallback()) {
    const browserProjectsForDiscovery = getBrowserProjectsForDiscovery();
    const discoveryResult = await runBrowserModeTests(
      context,
      browserProjectsForDiscovery,
      {
        shardedEntries: getBrowserShardedEntries(browserProjectsForDiscovery),
        filesOnly: true,
        allowEmptyRun: true,
        appliedModifyRstestConfigEnvironments:
          appliedBrowserModifyRstestConfigEnvironments,
        onTraceEvents: forwardBrowserTraceEvents,
      },
    );
    if (discoveryResult?.hasFailure) {
      await discoveryResult.close?.();
      throw (
        discoveryResult.unhandledErrors?.[0] ??
        new Error('Failed to initialize Browser Mode discovery.')
      );
    }
    await discoveryResult?.close?.();
    hasRunBrowserConfigHookDiscovery = true;
    plan = await resolveRunnableProjects({
      silentShardMessage: true,
      strictEnvironmentComments: true,
    });
    syncNodeProjects(rsbuildProjects, plan.nodeProjectsToRun);
    ({ hasBrowserTestsToRun, hasNodeTestsToRun } = syncRunPlanFlags());
  }

  if (nodeProjects.length) {
    await rsbuildInstance.initConfigs({ action: 'dev' });
    plan = projectPlanState.getPlan();
    ({ hasBrowserTestsToRun, hasNodeTestsToRun } = syncRunPlanFlags());
  }

  if (hasNodeTestsToRun || hasBrowserTestsToRun) {
    await ensureRunDependencies({
      projects: [],
      rootPath,
      coverage,
    });

    if (coveragePluginLoadError) {
      throw coveragePluginLoadError;
    }
  }

  if (!hasNodeTestsToRun && !hasBrowserTestsToRun) {
    const coverageProvider = await createCoverageProviderWithLog(
      context,
      coverage.enabled && !coveragePluginLoadError,
    );

    // No tests on either side: route the empty run through the shared finalize
    // (empty outcomes → reportNoTestFiles + onTestRunEnd + empty coverage) like
    // every other non-watch path, instead of a hand-rolled notify + coverage
    // clone.
    await finalizeRunCycle(context, {
      outcomes: [],
      mode: 'all',
      isWatchMode,
      coverageProvider,
      reportOnFailure: coverage.reportOnFailure,
      traceRun: activeTraceRun,
      currentDeletedEntries: [],
    });

    await runLifecycleStep('trace shutdown', () =>
      traceController.shutdown(activeTraceRun),
    );
    return;
  }

  // If there are no node tests to run, we can potentially exit early.
  if (!hasNodeTestsToRun) {
    // Mixed run whose node projects resolved to zero files (#1363): `run()` is
    // never invoked, so route the browser result through the shared
    // `finalizeRunCycle` here — the same non-watch finalize every other path
    // uses — and tear the browser down in this block's `finally`.
    if (hasBrowserTestsToRun) {
      const browserProjectsToRun = getBrowserProjectsToRun();
      const browserEntries = getBrowserShardedEntries(browserProjectsToRun);

      if (isWatchMode) {
        // Mixed watch with zero node files: the browser host's watch path owns
        // the run lifecycle (`onTestRunStart`/`onTestRunEnd` per rerun) and
        // keeps the session alive, so core must not emit a second lifecycle or
        // finalize while the session runs — mirror the browser-only watch
        // branch above.
        try {
          await runBrowserModeTests(context, browserProjectsToRun, {
            shardedEntries: browserEntries,
            freezeShardedEntries: Boolean(shard && nodeProjects.length),
            allowEmptyWatchRun: context.relatedResolutionEmpty,
            appliedModifyRstestConfigEnvironments:
              appliedBrowserModifyRstestConfigEnvironments,
            onTraceEvents: forwardBrowserTraceEvents,
          });
        } finally {
          await runLifecycleStep('trace shutdown', () =>
            traceController.shutdown(activeTraceRun),
          );
        }
        return;
      }

      const coverageProvider = await createCoverageProviderWithLog(
        context,
        coverage.enabled,
      );

      // The host defers reporter lifecycle to the caller in non-watch mode;
      // emit `onTestRunStart` BEFORE the browser host starts streaming file
      // events through the shared sink (finalizeRunCycle emits the matching
      // `onTestRunEnd`), mirroring `run()`.
      await notifyReportersOnTestRunStart(context);

      const browserResult = await runBrowserModeTests(
        context,
        browserProjectsToRun,
        {
          shardedEntries: browserEntries,
          freezeShardedEntries: Boolean(shard && nodeProjects.length),
          allowEmptyRun: shouldAllowEmptyBrowserFallback(),
          appliedModifyRstestConfigEnvironments:
            appliedBrowserModifyRstestConfigEnvironments,
          onTraceEvents: forwardBrowserTraceEvents,
        },
      );
      try {
        await finalizeBrowserRun(context, browserResult, {
          coverageProvider,
          reportOnFailure: coverage.reportOnFailure,
          traceRun: activeTraceRun,
        });
      } finally {
        // Flush any browser events into the pre-allocated trace buffer so
        // `--trace` still produces a file for filtered mixed-mode runs (the
        // browser teardown itself runs inside `finalizeBrowserRun`).
        await runLifecycleStep('trace shutdown', () =>
          traceController.shutdown(activeTraceRun),
        );
      }
      return;
    }
    // If no node projects at all, and no browser tests to run,
    // then nothing to do here. This handles the original early exit for no node projects.
    if (!hasNodeProjects) {
      return;
    }
  }

  const { getRsbuildStats, closeServer } = await createRsbuildServer({
    inspectedConfig: {
      ...context.normalizedConfig,
      // Pass only the relevant node projects for Rsbuild processing
      projects: rsbuildProjects.map((p) => p.normalizedConfig),
    },
    isWatchMode,
    globTestSourceEntries,
    setupFiles: setupFileState.setupFiles,
    globalSetupFiles: setupFileState.globalSetupFiles,
    rsbuildInstance,
    rootPath,
  });

  // The `projects` variable now refers to node projects that have tests to run.
  const { entriesCache, nodeProjectsToRun: projects } =
    projectPlanState.getPlan();

  try {
    await ensureTestEnvironmentDependencies(projects, rootPath);
  } catch (error) {
    await closeServer();
    throw error;
  }

  // If there are browser tests to run, start them after node environment
  // dependencies are validated so early dependency failures do not leave a
  // browser host running.
  if (hasBrowserTestsToRun) {
    const browserProjectsToRun = getBrowserProjectsToRun();
    browserResultPromise = runBrowserModeTests(context, browserProjectsToRun, {
      // In non-watch runs the host defers teardown + reporting to core's
      // unified `finalizeRunCycle` (its internal `isWatchMode` gate); watch
      // runs self-finalize host-side.
      shardedEntries: getBrowserShardedEntries(browserProjectsToRun),
      freezeShardedEntries: Boolean(shard && nodeProjects.length),
      allowEmptyRun: shouldAllowEmptyBrowserFallback(),
      allowEmptyWatchRun: isWatchMode && context.relatedResolutionEmpty,
      appliedModifyRstestConfigEnvironments:
        appliedBrowserModifyRstestConfigEnvironments,
      onTraceEvents: forwardBrowserTraceEvents,
    });

    // Prevent an unhandled rejection window in mixed node+browser runs.
    // We still await the original promise later to surface the error.
    browserResultPromise.catch(() => undefined);
  }

  const entryFiles = Array.from(entriesCache.values()).reduce<string[]>(
    (acc, entry) => acc.concat(Object.values(entry.entries) || []),
    [],
  );

  const getRecommendWorkerCount = (): number => {
    // TODO: the best way is to create workers on demand
    const nodeEntries = Array.from(entriesCache.entries()).filter(([key]) => {
      const project = projects.find((p) => p.environmentName === key);
      return project?.normalizedConfig.browser.enabled !== true;
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

  // Initialize coverage collector
  const coverageProvider = await createCoverageProviderWithLog(
    context,
    coverage.enabled,
  );

  type Mode = 'all' | 'on-demand';

  // Per-compile id, bumped on every `run()` (initial build + each watch
  // rebuild) and threaded to the worker so it can flush its kept cache on a
  // rebuild boundary (#1373).
  let buildId = 0;

  const run = async ({
    fileFilters,
    mode = 'all',
    buildStart = Date.now(),
  }: {
    fileFilters?: string[];
    mode?: Mode;
    buildStart?: number;
  } = {}) => {
    buildId += 1;

    await notifyReportersOnTestRunStart(context);

    let testStart: number | undefined;
    const currentEntries: EntryInfo[] = [];
    const currentDeletedEntries: string[] = [];

    // `stateManager.reset()` is not called here: non-watch runs reset once at
    // the top of `runTests` (before either executor streams), and watch reruns
    // reset via `prepareWatchRerunState` at each rerun trigger below.
    // TODO: this is not the best practice for collecting test files
    context.stateManager.testFiles = isWatchMode ? undefined : entryFiles;

    // Perf-first ordering hints for this run: last-known duration + failure
    // state per test file. Read once (watch reruns pick up the freshly written
    // cache on the next `run()`); a missing/corrupt cache yields no hints and
    // falls back to bundle-size ordering.
    const resultsCache = await readResultsCache(rootPath);
    const sequenceHints: SequenceHints = new Map(
      Object.entries(resultsCache?.files ?? {}),
    );

    const mergedCoverageMap: CoverageMap | undefined = coverageProvider
      ? coverageProvider.createCoverageMap()
      : undefined;
    const rawCoverageResults: unknown[] = [];

    // Adopt the pre-allocated buffer (set above `runTests` or at the end of
    // the previous rerun's `finalize`) so browser events emitted before
    // `run()` are captured.
    const traceRun = activeTraceRun;
    // `span` is a transparent pass-through when tracing is disabled
    // (see `beginRun` in utils/trace.ts), so call sites stay branch-free.
    const { span } = traceRun;

    // Phase 1: resolve each project's build stats and candidate test files
    // (mode-filtered), and close over an `execute` continuation that runs them.
    // Execution is deferred because `--onlyFailures` (phase 2) needs the full
    // candidate set across every project before it can decide whether any
    // failed file is left to run.
    const projectPlans = await Promise.all(
      projects.map(async (p) => {
        const {
          assetNames,
          entries,
          setupEntries,
          globalSetupEntries,
          getAssetFiles,
          getSourceMaps,
          affectedEntries,
          deletedEntries,
        } = await span(
          'host:get-rsbuild-stats',
          'host',
          () =>
            getRsbuildStats({
              environmentName: p.environmentName,
              fileFilters,
            }),
          { project: p.name, testPath: '<project>' },
        );

        testStart ??= Date.now();

        currentDeletedEntries.push(...deletedEntries);

        let finalEntries: EntryInfo[] = entries;
        if (mode === 'on-demand') {
          if (affectedEntries.length === 0) {
            logger.debug(
              color.yellow(
                `No test files need re-run in project(${p.environmentName}).`,
              ),
            );
          } else {
            logger.debug(
              color.yellow(
                `Test files to re-run in project(${p.environmentName}):\n`,
              ) +
                affectedEntries.map((e) => e.testPath).join('\n') +
                '\n',
            );
          }
          finalEntries = affectedEntries;
        } else {
          logger.debug(
            color.yellow(
              fileFilters?.length
                ? `Run filtered tests in project(${p.environmentName}).\n`
                : `Run all tests in project(${p.environmentName}).\n`,
            ),
          );
        }

        const execute = async (selectedEntries: EntryInfo[]) => {
          // Global setup runs once per project, only if there is at least one
          // running test. Gate on the selected (possibly `--onlyFailures`-
          // narrowed) set, not the full candidate set: a project deselected to
          // zero files this run must not run its setup/teardown side effects.
          if (
            claimGlobalSetupOnce(
              p,
              selectedEntries.length,
              globalSetupEntries.length,
            )
          ) {
            const files = globalSetupEntries.flatMap((e) => e.files!);
            const globalSetupTraceArgs = {
              project: p.name,
              testPath: '<globalSetup>',
            };
            const [assetFiles, sourceMaps] = await span(
              'host:global-setup-assets',
              'host',
              () => Promise.all([getAssetFiles(files), getSourceMaps(files)]),
              globalSetupTraceArgs,
            );

            const { success, errors } = await span(
              'host:global-setup',
              'host',
              () =>
                runGlobalSetup({
                  globalSetupEntries,
                  assetFiles,
                  sourceMaps,
                  interopDefault: true,
                  outputModule: p.outputModule,
                }),
              globalSetupTraceArgs,
            );
            if (!success) {
              return {
                results: [],
                testResults: [],
                errors,
                assetNames,
                // sourcemap is useless since we install source-map-support in worker
                getSourceMaps: () => null,
              };
            }
          }

          // Perf-first ordering, applied per project (the pool interleaves
          // projects via a shared FIFO, but each project's stream stays ordered).
          const sortedEntries = sortTestEntries(
            selectedEntries,
            sequenceHints,
            (testPath) => sequenceKey(p.name, rootPath, testPath),
          );

          currentEntries.push(...sortedEntries);
          const { results, testResults } = await pool.runTests({
            entries: sortedEntries,
            getSourceMaps,
            setupEntries,
            getAssetFiles,
            project: p,
            buildId,
            updateSnapshot: context.snapshotManager.options.updateSnapshot,
            onCoverageResult: (coverage) => mergedCoverageMap?.merge(coverage),
            onRawCoverageResult: (coverage) =>
              rawCoverageResults.push(coverage),
            onTraceEvents: traceRun.onEvents,
            traceSpan: span,
          });

          return {
            results,
            testResults,
            assetNames,
            getSourceMaps,
          };
        };

        return { p, finalEntries, execute };
      }),
    );

    // Phase 2: `--onlyFailures` file-level selection. Runs after every project's
    // candidate set is known (so the global "nothing failed → run everything"
    // fallback is decidable) and before perf-first ordering / test execution (so
    // deselected files are never ordered or run). Sharding for node projects is
    // resolved further upstream in `projectPlan`; because a file's shard
    // assignment is deterministic, filtering the failed subset within each shard
    // still re-runs every failed file across the full shard matrix.
    //
    // Watch mode and `--changed`/`--related` runs ignore `--onlyFailures`
    // entirely (warned once at setup), so they are skipped here. The
    // `relatedMode` check also covers the forceRerunTriggers path, which
    // deliberately clears all file filters to force a full-suite rerun —
    // failure selection must not narrow that back down. `mode === 'on-demand'`
    // only occurs under watch and stays guarded defensively.
    //
    // A `testNamePattern` (`-t`) run must search every file for matching tests,
    // so it is skipped too: narrowing to the previously-failed files would
    // silently drop matching tests that live in files which passed last run.
    // This mirrors the cache-write guard below, which also treats a
    // `testNamePattern` run as partial.
    //
    // An explicitly user-scoped run must never be narrowed further by failure
    // history. Two forms of explicit scoping exist: positional CLI filters live
    // on `context.fileFilters` (they drive the build-stats entry set), while the
    // watch `runFailedTests` shortcut passes its file list as the `fileFilters`
    // argument with `mode: 'all'`. That shortcut hands us the IN-MEMORY failed
    // set; intersecting it with the on-disk cache — which is intentionally stale
    // after a bail-aborted or `testNamePattern` run that skipped its write —
    // could wrongly deselect a file that just failed in memory.
    const isExplicitlyScoped = !!(
      fileFilters?.length || context.fileFilters?.length
    );
    if (
      context.normalizedConfig.onlyFailures &&
      !isWatchMode &&
      !context.relatedMode &&
      !context.normalizedConfig.testNamePattern &&
      mode !== 'on-demand' &&
      !isExplicitlyScoped
    ) {
      applyOnlyFailuresSelection(projectPlans, {
        resultsCache,
        sequenceHints,
        rootPath,
      });
    }

    // Phase 3: run each project with its final (possibly narrowed) selection.
    const returns = await Promise.all(
      projectPlans.map((plan) => plan.execute(plan.finalEntries)),
    );

    testStart ??= buildStart;
    const buildTime = testStart - buildStart;

    // Wait for browser tests to complete if running in parallel
    const browserResult = browserResultPromise
      ? await browserResultPromise
      : undefined;
    const browserClose = browserResult?.close;

    try {
      const nodeResourceByAssetName = new Map<
        string,
        (typeof returns)[number]['getSourceMaps']
      >();

      for (const item of returns) {
        for (const assetName of item.assetNames) {
          nodeResourceByAssetName.set(assetName, item.getSourceMaps);
        }
      }

      const testTime = Date.now() - testStart;

      // Node outcome. Its source map resolver reports `handled: false` for
      // assets it doesn't own, so a mixed run falls through to the browser
      // resolver.
      const outcomes: ExecutorCycleOutcome[] = [
        {
          results: returns.flatMap((r) => r.results),
          testResults: returns.flatMap((r) => r.testResults),
          errors: returns.flatMap((r) => r.errors || []),
          testPaths: currentEntries.map((e) => e.testPath),
          duration: { buildTime, testTime },
          // The pool merged istanbul per-file coverage into `mergedCoverageMap`
          // and accumulated v8 raw batches into `rawCoverageResults` via its
          // callbacks; carry both through the outcome's coverage channel.
          coverage: {
            map: mergedCoverageMap?.toJSON(),
            raw: rawCoverageResults,
          },
          resolveSourcemap: async (sourcePath) => {
            const getSourceMaps = nodeResourceByAssetName.get(sourcePath);
            const sourceMap = (await getSourceMaps?.([sourcePath]))?.[
              sourcePath
            ];
            return {
              handled: sourceMap != null,
              sourcemap: sourceMap ? JSON.parse(sourceMap) : null,
            };
          },
        },
      ];

      // In watch mode browser and node tests finalize independently, so only a
      // non-watch unified run folds the browser result into this cycle.
      if (shouldUnifyReporter && browserResult) {
        outcomes.push(toBrowserOutcome(browserResult, coverageProvider));
      }

      await finalizeRunCycle(context, {
        outcomes,
        mode,
        isWatchMode,
        coverageProvider,
        reportOnFailure: coverage.reportOnFailure,
        traceRun,
        currentDeletedEntries,
      });

      // A run is "bail-aborted" once the failed-test count reaches the bail
      // limit: the pool then returns a synthetic `skip` result for every
      // not-yet-loaded file (see `runInPool`), and the runner stops executing
      // the remaining tests of the file it was in. From that point on no file
      // result describes a complete execution.
      const bailLimit = context.normalizedConfig.bail;
      const bailAborted =
        bailLimit > 0 &&
        context.stateManager.getCountOfFailedTests() >= bailLimit;

      // Persist node results for next-run ordering. Uses `returns` (node-only;
      // browser results take a separate path). Best-effort —
      // `writeResultsCache` swallows its own IO errors.
      //
      // Skip the write for any run that doesn't fully describe every file it
      // touched, so a partial run can't poison the perf-first cache:
      //   - `testNamePattern`: only the matching subset of each file runs, so a
      //     quick `-t` run could make a slow file look fast, or clear a failing
      //     file's failed-first bit when the matched test passes.
      //   - bail abort: the not-yet-run files come back as synthetic `skip`s, so
      //     writing them would clear the failed-first bit of a previously
      //     failing file that simply never got its turn this run.
      // The last full-run record stays authoritative in both cases.
      if (!context.normalizedConfig.testNamePattern && !bailAborted) {
        await writeResultsCache(
          rootPath,
          returns.flatMap((r) => r.results),
          currentDeletedEntries,
        );
      }

      // Pre-allocate the next watch-rerun buffer so browser events emitted
      // between reruns (or before the next `run()` adopts a fresh buffer)
      // are not lost.
      activeTraceRun = traceController.beginRun();
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
        await runLifecycleStep('worker pool cleanup', () => pool.close());
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
      await runLifecycleStep('worker pool cleanup', () => pool.close());
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
      prepareWatchRerunState(context);
      await run({ buildStart, mode: isFirstCompile ? 'all' : 'on-demand' });
      buildStart = undefined;

      if (isFirstCompile && enableCliShortcuts) {
        const closeCliShortcuts = await setupCliShortcuts({
          closeServer: async () => {
            await runLifecycleStep('worker pool cleanup', () => pool.close());
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
            prepareWatchRerunState(context);
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
            prepareWatchRerunState(context);
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
            prepareWatchRerunState(context);
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

            prepareWatchRerunState(context);

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
            prepareWatchRerunState(context);
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
        await runLifecycleStep('worker pool cleanup', () => pool.close());
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
      await runLifecycleStep('worker pool cleanup', () => pool.close());
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
