import { constants as osConstants } from 'node:os';
import { isAbsolute, normalize, relative, resolve } from 'pathe';
import { cleanCoverageReports, createCoverageProvider } from '../coverage';
import { ensureRunDependencies } from './dependencies';
import type { ProjectContext, TestExecutor, TestFileResult } from '../types';
import type { CoverageMap, CoverageProvider } from '../types/coverage';
import {
  clearScreen,
  color,
  createTraceController,
  getForceRerunTriggerMessage,
  logger,
  type TraceEvent,
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
import { createNodeExecutor } from './executors/nodeExecutor';
import { runGlobalTeardown } from './globalSetup';
import { isBrowserProject, isNodeProject } from './isBrowserProject';
import type { Rstest } from './rstest';
import { prepareWatchRerunState } from './watchState';
import { getUserRstestConfigPluginProjects } from './modifyRstestConfig';

/**
 * Run browser mode tests host-driven (watch self-finalize path). Non-watch runs
 * go through {@link BrowserExecutor} instead; this shim stays for the browser
 * watch loop and the browser-only watch coverage path.
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
  return runBrowserTests(context, { ...options, projects: browserProjects });
}

/**
 * Load `@rstest/browser` and build the browser side of the executor seam,
 * validating the browser config first. Core never statically imports playwright;
 * the executor is obtained through the version-locked dynamic module.
 */
async function loadBrowserExecutor(
  context: Rstest,
  browserProjects: typeof context.projects,
  coverageProvider: CoverageProvider | null,
  runOptions?: Pick<
    BrowserTestRunOptions,
    | 'freezeShardedEntries'
    | 'allowEmptyRun'
    | 'appliedModifyRstestConfigEnvironments'
  >,
): Promise<TestExecutor> {
  const projectRoots = browserProjects.map((p) => p.rootPath);
  const { validateBrowserConfig, createBrowserExecutor } =
    await loadBrowserModule({
      projectRoots,
      embedded: context.embedded,
    });
  validateBrowserConfig(context);
  return createBrowserExecutor(context, {
    projects: browserProjects,
    coverageProvider,
    ...runOptions,
  });
}

const getSignalExitCode = (signal: NodeJS.Signals): number => {
  const signalNumber = osConstants.signals[signal];
  return typeof signalNumber === 'number' ? 128 + signalNumber : 1;
};

/**
 * Merge the browser host's per-file `result.coverage` into one map, stripping it
 * from each result to avoid reporter/state cache bloat. Used by the browser-only
 * watch path, which still self-finalizes host-side (Phase 6 convergence).
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

export async function runTests(context: Rstest): Promise<void> {
  // High-level flow (post-executor-seam):
  // 1. Split browser/node projects (the single `isBrowserProject` predicate).
  // 2. Browser-only runs (no node projects) take a fast path so they skip the
  //    node Rsbuild server + worker pool entirely (cold-start gate: retained).
  // 3. Otherwise construct a `NodeExecutor`, `init()` it (its `modifyRstestConfig`
  //    hooks fire and the plan resolves — the §3.4 barrier), then construct a
  //    `BrowserExecutor` from the resolved plan.
  // 4. Non-watch: `Promise.all(executors.map(e => e.runCycle()))` → one
  //    `finalizeRunCycle` → one `executors.close()` exit path.
  // 5. Watch: node reruns iterate the node executor only; browser watch stays
  //    host-driven and self-finalizing (Phase 6 converges it).
  cleanCoverageReports(context.normalizedConfig.coverage);

  if (context.relatedRerunReason === 'forceRerunTrigger') {
    logger.log(`${color.yellow(getForceRerunTriggerMessage(context))}\n`);
  }

  const browserProjects = context.projects.filter(isBrowserProject);
  const nodeProjects = context.projects.filter(isNodeProject);

  const hasBrowserProjects = browserProjects.length > 0;
  const hasNodeProjects = nodeProjects.length > 0;

  const isWatchMode = context.command === 'watch';

  // Reset the per-run test state once, before any executor streams events into
  // `stateManager`. Watch reruns own their own reset via `prepareWatchRerunState`.
  if (!isWatchMode) {
    context.stateManager.reset();
  }

  // `onlyFailures` applies only to a plain, full run; every other scoping
  // mechanism wins over failure history. Warn once and ignore (rather than
  // erroring) so a shared config carrying `onlyFailures` stays usable everywhere.
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

  const { coverage, shard } = context.normalizedConfig;
  const { rootPath, snapshotManager } = context;

  const getEmptyRunDuration = () => ({
    totalTime: 0,
    buildTime: 0,
    testTime: 0,
  });

  // Constructed before the browser-only fast path so `--trace` is honored for
  // pure-browser runs (browser host forwards events via `onTraceEvents`).
  const traceController = createTraceController({
    enabled: context.trace,
    rootPath: context.rootPath,
  });
  // Pre-allocated so browser events emitted before a cycle adopts a fresh buffer
  // (or in filtered runs where no cycle runs) are not silently dropped.
  let activeTraceRun = traceController.beginRun();
  const forwardBrowserTraceEvents = context.trace
    ? (events: TraceEvent[]) => activeTraceRun.onEvents?.(events)
    : undefined;

  // ===================================================================
  // Browser-only fast path (no node projects). Retained per the cold-start
  // gate: constructing/`init()`-ing a NodeExecutor here would add the node
  // Rsbuild instance to every pure-browser run.
  // ===================================================================
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

    await ensureRunDependencies({
      projects: [],
      rootPath: context.rootPath,
      coverage,
    });

    const traceRun = traceController.beginRun();

    if (isWatchMode) {
      if (coverage.enabled) {
        logger.log(
          ` ${color.gray('Coverage enabled with')} %s\n`,
          color.yellow(coverage.provider),
        );
      }
      // Browser-only watch: the host owns per-rerun finalize. The bespoke
      // coverage report runs once after the watch session exits (Phase 6
      // converges this onto the executor seam).
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
      // Browser-only non-watch: one browser executor through the shared loop —
      // exit code, reporter output, coverage, and the no-test path match node
      // and mixed runs.
      const coverageProvider = await createCoverageProviderWithLog(
        context,
        coverage.enabled,
      );
      const browserExecutor = await loadBrowserExecutor(
        context,
        browserProjects,
        coverageProvider,
      );
      await browserExecutor.init();

      await notifyReportersOnTestRunStart(context);
      try {
        const outcome = await browserExecutor.runCycle({
          buildId: 1,
          mode: 'all',
          updateSnapshot: snapshotManager.options.updateSnapshot,
          onTraceEvents: traceRun.onEvents,
        });
        await finalizeRunCycle(context, {
          outcomes: [outcome],
          mode: 'all',
          isWatchMode: false,
          coverageProvider,
          reportOnFailure: coverage.reportOnFailure,
          traceRun,
          currentDeletedEntries: [],
        });
      } finally {
        await runLifecycleStep('executor cleanup', () =>
          browserExecutor.close(),
        );
      }
    }

    await runLifecycleStep('trace shutdown', () =>
      traceController.shutdown(traceRun),
    );
    return;
  }

  // ===================================================================
  // Mixed / node path. Init barrier: node executor first (hooks fire, plan
  // resolves), then the browser executor from the resolved plan.
  // ===================================================================
  const nodeExecutor = createNodeExecutor(context, {
    browserProjects,
    nodeProjects,
    isWatchMode,
    getTraceRun: () => activeTraceRun,
  });
  await nodeExecutor.init();

  // ---- Browser config-hook discovery (mixed runs, from #1521) ----------
  // `modifyRstestConfig` hooks on browser projects only apply inside a browser
  // runtime boot, and a hook can add test files to an otherwise-empty browser
  // project. When the plan may depend on them, boot the browser side once in
  // files-only mode, then re-resolve the plan before reading the run flags.
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
  const appliedBrowserModifyRstestConfigEnvironments = new Set<string>();
  let hasRunBrowserConfigHookDiscovery = false;

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
    nodeExecutor.hasNodeTestsToRun() &&
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
    const currentPlan = nodeExecutor.getPlan();
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
    const currentPlan = nodeExecutor.getPlan();
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
    await nodeExecutor.refreshPlan();
  }

  const hasNodeTestsToRun = nodeExecutor.hasNodeTestsToRun();
  const hasBrowserTestsToRun =
    nodeExecutor.hasBrowserTestsToRun() || shouldRunBrowserDiscoveryFallback();

  if (hasNodeTestsToRun || hasBrowserTestsToRun) {
    await ensureRunDependencies({ projects: [], rootPath, coverage });
    const coveragePluginLoadError = nodeExecutor.coveragePluginLoadError();
    if (coveragePluginLoadError) {
      throw coveragePluginLoadError;
    }
  }

  // Nothing to run on either side: route the empty run through the shared
  // finalize like every other non-watch path.
  if (!hasNodeTestsToRun && !hasBrowserTestsToRun) {
    const coverageProvider = await createCoverageProviderWithLog(
      context,
      coverage.enabled && !nodeExecutor.coveragePluginLoadError(),
    );
    await finalizeRunCycle(context, {
      outcomes: [],
      mode: 'all',
      isWatchMode,
      coverageProvider,
      reportOnFailure: coverage.reportOnFailure,
      traceRun: activeTraceRun,
      currentDeletedEntries: [],
    });
    await runLifecycleStep('executor cleanup', () => nodeExecutor.close());
    await runLifecycleStep('trace shutdown', () =>
      traceController.shutdown(activeTraceRun),
    );
    return;
  }

  const coverageProvider = await createCoverageProviderWithLog(
    context,
    coverage.enabled,
  );
  nodeExecutor.setCoverageProvider(coverageProvider);

  // Shared browser run options: in a sharded mixed run the node side already
  // resolved the browser shard slice, so the host must not re-shard on a config
  // hook refresh; the applied-environments set keeps browser hooks single-shot
  // across the discovery boot and the real run.
  const freezeBrowserShardedEntries = Boolean(shard && nodeProjects.length);

  // ===================================================================
  // Non-watch: one executor loop, one finalize, one close exit path.
  // ===================================================================
  if (!isWatchMode) {
    let browserShardedEntries:
      Map<string, { entries: Record<string, string> }> | undefined;
    // Start the node resources (dev server, env-dependency validation, pool)
    // BEFORE constructing the browser executor, so an early node dependency
    // failure (e.g. missing `jsdom`) never leaves a browser host mid-launch —
    // the same deliberate ordering the pre-seam code had. The build/stats phase
    // inside `runCycle` still overlaps with the browser run below.
    if (hasNodeTestsToRun) {
      await nodeExecutor.ensureRunResources();
    }

    const executors: TestExecutor[] = hasNodeTestsToRun ? [nodeExecutor] : [];

    // Single-exit-path rule: every executor closes through here exactly once
    // (idempotent), so no early return or throw can reintroduce a #1363-class
    // deferred-teardown hang. `executors` is read at close time, so the browser
    // executor pushed inside the try below is covered — including when its own
    // load/init fails with the node resources above already up.
    let didCloseExecutors = false;
    const closeExecutors = async () => {
      if (didCloseExecutors) {
        return;
      }
      didCloseExecutors = true;
      await Promise.all(
        executors.map((executor) =>
          runLifecycleStep('executor cleanup', () => executor.close()),
        ),
      );
    };

    let isTeardown = false;
    let isCleaningUp = false;
    const cleanup = async () => {
      if (isCleaningUp) {
        return;
      }
      isCleaningUp = true;
      try {
        await closeExecutors();
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
        runGlobalTeardown().catch((error) => {
          logger.log(color.red(`Error in global teardown: ${error}`));
        });
        process.exitCode = 1;
      }
    };

    const handleSignal = async (signal: NodeJS.Signals) => {
      logger.log(color.yellow(`\nReceived ${signal}, cleaning up...`));
      await cleanup();
      process.exit(getSignalExitCode(signal));
    };

    if (!context.embedded) {
      process.on('exit', unExpectedExit);
      process.on('SIGINT', handleSignal);
      process.on('SIGTERM', handleSignal);
      process.on('SIGTSTP', handleSignal);
    }

    try {
      if (hasBrowserTestsToRun) {
        const browserProjectsToRun = getBrowserProjectsToRun();
        browserShardedEntries = getBrowserShardedEntries(browserProjectsToRun);
        const browserExecutor = await loadBrowserExecutor(
          context,
          browserProjectsToRun,
          coverageProvider,
          {
            freezeShardedEntries: freezeBrowserShardedEntries,
            allowEmptyRun: shouldAllowEmptyBrowserFallback(),
            appliedModifyRstestConfigEnvironments:
              appliedBrowserModifyRstestConfigEnvironments,
          },
        );
        executors.push(browserExecutor);
        await browserExecutor.init();
      }

      await notifyReportersOnTestRunStart(context);
      const outcomes = await Promise.all(
        executors.map((executor) =>
          executor.runCycle({
            buildId: 1,
            mode: 'all',
            updateSnapshot: snapshotManager.options.updateSnapshot,
            shardedEntries: browserShardedEntries,
            onTraceEvents: forwardBrowserTraceEvents,
          }),
        ),
      );

      await finalizeRunCycle(context, {
        outcomes,
        mode: 'all',
        isWatchMode: false,
        coverageProvider,
        reportOnFailure: coverage.reportOnFailure,
        traceRun: activeTraceRun,
        currentDeletedEntries: hasNodeTestsToRun
          ? nodeExecutor.getLastCycleDeletedEntries()
          : [],
      });
      isTeardown = true;
    } finally {
      await closeExecutors();
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
    return;
  }

  // ===================================================================
  // Watch mode. Browser watch stays host-driven (self-finalizing); node reruns
  // iterate the node executor only, so a node rebuild never re-triggers the
  // browser initial run.
  // ===================================================================

  // Mixed watch with zero node files: only the browser side runs (host-driven).
  if (!hasNodeTestsToRun) {
    const browserProjectsToRun = getBrowserProjectsToRun();
    try {
      await runBrowserModeTests(context, browserProjectsToRun, {
        shardedEntries: getBrowserShardedEntries(browserProjectsToRun),
        freezeShardedEntries: freezeBrowserShardedEntries,
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

  // Start the browser watch session once (self-finalizing); node reruns below
  // never restart it. Deferred until after `ensureRunResources()` at the end of
  // this function, so node env-dependency validation failures never leave a
  // browser host running (the same ordering the pre-seam code had).
  const startBrowserWatchSession = () => {
    if (!hasBrowserTestsToRun) {
      return;
    }
    const browserProjectsToRun = getBrowserProjectsToRun();
    const browserWatchPromise = runBrowserModeTests(
      context,
      browserProjectsToRun,
      {
        shardedEntries: getBrowserShardedEntries(browserProjectsToRun),
        freezeShardedEntries: freezeBrowserShardedEntries,
        allowEmptyRun: shouldAllowEmptyBrowserFallback(),
        allowEmptyWatchRun: context.relatedResolutionEmpty,
        appliedModifyRstestConfigEnvironments:
          appliedBrowserModifyRstestConfigEnvironments,
        onTraceEvents: forwardBrowserTraceEvents,
      },
    );
    // The session promise is not awaited (it spans the whole watch session),
    // so surface a failed browser boot instead of silently dropping it — the
    // pre-seam code awaited the initial browser run and aborted on this.
    browserWatchPromise.catch((error) => {
      logger.error(
        color.red('Browser Mode watch session failed to start:'),
        error,
      );
      process.exitCode = 1;
    });
  };

  type Mode = 'all' | 'on-demand';
  let buildId = 0;

  // One node watch cycle: reset already happened via `prepareWatchRerunState`
  // at each trigger; run the node executor, then the shared finalize.
  const run = async ({
    fileFilters,
    mode = 'all',
    buildStart,
  }: {
    fileFilters?: string[];
    mode?: Mode;
    buildStart?: number;
  } = {}) => {
    buildId += 1;
    await notifyReportersOnTestRunStart(context);
    const outcome = await nodeExecutor.runCycle({
      buildId,
      mode,
      fileFilters,
      buildStart,
      updateSnapshot: snapshotManager.options.updateSnapshot,
    });
    await finalizeRunCycle(context, {
      outcomes: [outcome],
      mode,
      isWatchMode: true,
      coverageProvider,
      reportOnFailure: coverage.reportOnFailure,
      traceRun: activeTraceRun,
      currentDeletedEntries: nodeExecutor.getLastCycleDeletedEntries(),
    });
    // Pre-allocate the next watch-rerun buffer so browser events emitted between
    // reruns are not lost.
    activeTraceRun = traceController.beginRun();
  };

  const enableCliShortcuts = isCliShortcutsEnabled();

  let isCleaningUp = false;
  const cleanup = async () => {
    if (isCleaningUp) {
      return;
    }
    isCleaningUp = true;

    try {
      await runLifecycleStep('executor cleanup', () => nodeExecutor.close());
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
    process.exit(getSignalExitCode(signal));
  };

  if (!context.embedded) {
    process.on('SIGINT', handleSignal);
    process.on('SIGTERM', handleSignal);
    process.on('SIGTSTP', handleSignal);
  }

  const afterTestsWatchRun = () => {
    logger.log(color.green('  Waiting for file changes...'));

    if (enableCliShortcuts) {
      if (snapshotManager.summary.unmatched) {
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
    await runLifecycleStep('executor cleanup', () => nodeExecutor.close());
    await runLifecycleStep('trace run finalize', () =>
      activeTraceRun.finalize(),
    );
    await runLifecycleStep('trace controller cleanup', () =>
      traceController.close(),
    );
  });

  let buildStart: number | undefined;

  const rsbuildInstance = nodeExecutor.getRsbuildInstance();

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
          await runLifecycleStep('executor cleanup', () =>
            nodeExecutor.close(),
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

          await run({ mode: 'all' });
          afterTestsWatchRun();
        },
        runWithTestNamePattern: async (pattern?: string) => {
          clearScreen();
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
          const entries = await nodeExecutor.globTestEntries();

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

          const originalUpdateSnapshot = snapshotManager.options.updateSnapshot;
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

  // Start the node dev server now that the compile hooks are registered: its
  // first compile fires `onAfterDevCompile`, which drives the initial watch run.
  // `runCycle` (invoked from that hook) reuses these resources via the in-flight
  // guard rather than starting a second server.
  await nodeExecutor.ensureRunResources();

  // Node resources are up (env dependencies validated); now the browser watch
  // session may launch.
  startBrowserWatchSession();
}
