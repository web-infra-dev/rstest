import {
  cleanCoverageReports,
  createCoverageProviderWithLog,
} from '../coverage';
import type {
  CoreTestRunner,
  NormalizedConfig,
  ProjectContext,
  RunnerBuildOutput,
  RunnerCycleOptions,
} from '../types';
import type { CoverageProvider } from '../types/coverage';
import {
  color,
  createTraceController,
  filterFiles,
  getForceRerunTriggerMessage,
  logger,
} from '../utils';
import { ensureRunDependencies } from './dependencies';
import {
  createNodeExecutor,
  type NodeExecutor,
} from './executors/nodeExecutor';
import { runAndFinalizeCycle, runLifecycleStep } from './finalizeRun';
import { runGlobalTeardown } from './globalSetup';
import { isBrowserProject, isNodeProject } from './isBrowserProject';
import { createRunPlanner, type RunPlanner } from './planner';
import type { Rstest } from './rstest';
import { prepareWatchCycleState } from './watchState';

/**
 * Misuse messages the public `@rstest/core/api` runner re-throws. It guards
 * ahead of this driver (its own guard has to fire before the cycle wrapper
 * turns a throw into a resolved failing result), so both layers must say the
 * same thing — the programmatic e2e suite asserts on the text.
 */
export const RUNNER_CLOSED_MESSAGE = 'The test runner is closed.';
export const RUNNER_BUSY_MESSAGE =
  'A test run is already in progress; runs on one runner are serial.';

/** The config fields a run-scoped override patches on every layer. */
type RunConfigLayer = Pick<
  NormalizedConfig,
  'testNamePattern' | 'bail' | 'passWithNoTests'
>;

type RunOverrides = Pick<
  RunnerCycleOptions,
  'testNamePattern' | 'bail' | 'update' | 'passWithNoTests'
>;

/**
 * Patch the live state a cycle reads for run-scoped options, and return the
 * undo. Every field has two readers with independent copies: the root config
 * (bail summary, results-cache skip, no-test-files verdict, reporters) and each
 * dispatched project's config, which the pool projects into the worker's
 * `RuntimeConfig` per cycle. Patching one layer only is silently half-applied.
 *
 * `update` is not a config field at run time — the snapshot mode is read from
 * the snapshot manager per cycle — so it is overridden there instead.
 */
const applyRunOverrides = (
  context: Rstest,
  projects: ProjectContext[],
  { testNamePattern, bail, update, passWithNoTests }: RunOverrides,
): (() => void) => {
  const restores: (() => void)[] = [];
  const patch = <T, K extends keyof T>(
    target: T,
    key: K,
    value: T[K],
  ): void => {
    const original = target[key];
    restores.push(() => {
      target[key] = original;
    });
    target[key] = value;
  };

  const layers = new Set<RunConfigLayer>([
    context.normalizedConfig,
    ...projects.map((project) => project.normalizedConfig),
  ]);

  for (const layer of layers) {
    if (testNamePattern !== undefined) {
      patch(layer, 'testNamePattern', testNamePattern);
    }
    if (bail !== undefined) {
      // Mirrors the CLI's coercion: `true` bails on the first failure.
      patch(layer, 'bail', Number(bail));
    }
    if (passWithNoTests !== undefined) {
      patch(layer, 'passWithNoTests', passWithNoTests);
    }
  }

  if (update) {
    patch(context.snapshotManager.options, 'updateSnapshot', 'all');
  }

  return () => {
    for (const restore of restores) {
      restore();
    }
  };
};

/**
 * What one runner resolves once and reuses for every run: the planner that
 * answers every plan query, and the node executor built from its `nodeBuild`
 * (absent only on a run whose plan has no node projects at all, which then
 * executes nothing).
 */
type PreparedRun = {
  planner: RunPlanner;
  nodeExecutor: NodeExecutor | undefined;
};

/**
 * Build-once/run-many driver over the non-watch run pipeline.
 *
 * `runTests` compiles, runs and tears down in a single shot. This driver splits
 * that same pipeline so a host can compile once and execute the built set many
 * times: prepare (plan + node executor, once per runner) → build (compile +
 * run resources, memoized) → runCycle (one run) → close.
 *
 * The build is fixed for the runner's lifetime, output included: with command
 * `run` the entry plugin makes the compiler ignore every path, so it observes
 * no file change and re-triggering it reproduces the same output. Picking up
 * source edits would require running the runner's dev server with watching on,
 * which would recompile on its own schedule between runs — a different contract.
 *
 * Node projects only: browser projects are planned but never executed, so
 * callers gate on `isBrowserProject` before constructing a runner.
 *
 * Ownership split with the host: the driver owns run-scoped engine state (test
 * state, snapshot summary, reporter results, the exit code, `buildId`, trace
 * buffers) and runner-scoped resources (dev server, worker pool,
 * globalSetup/teardown). The host reads each cycle's exit code off the context and
 * decides what to do with it; the engine never touches `process.exitCode`.
 */
export function createTestRunner(context: Rstest): CoreTestRunner {
  const { rootPath, snapshotManager } = context;
  const { coverage } = context.normalizedConfig;

  const traceController = createTraceController({
    enabled: context.trace,
    rootPath,
  });
  let activeTraceRun = traceController.beginRun();

  let coverageProvider: CoverageProvider | null = null;
  let buildId = 0;
  let preparePromise: Promise<PreparedRun> | undefined;
  let buildPromise: Promise<RunnerBuildOutput> | undefined;
  let inFlightRun: Promise<void> | undefined;
  let closePromise: Promise<void> | undefined;

  let resolveCompileErrors: (messages: string[]) => void;
  // The dev server's first compile completes *after* `ensureRunResources()`
  // resolves, so `build()` waits on the compile hook rather than on server
  // startup. `Module not found` never shows up here: `pluginIgnoreResolveError`
  // strips it in the compiler's `done` hook so unresolved imports keep failing
  // at runtime instead of failing the build.
  const compileErrors = new Promise<string[]>((resolve) => {
    resolveCompileErrors = resolve;
  });

  const prepare = async (): Promise<PreparedRun> => {
    // Runner-scoped: every run regenerates the report from its own coverage
    // map, and wiping the directory per run would drop the previous run's
    // report whenever a narrowed run produces nothing.
    cleanCoverageReports(coverage);

    if (context.relatedRerunReason === 'forceRerunTrigger') {
      logger.log(`${color.yellow(getForceRerunTriggerMessage(context))}\n`);
    }

    const planner = await createRunPlanner(context, {
      browserProjects: context.projects.filter(isBrowserProject),
      nodeProjects: context.projects.filter(isNodeProject),
      // Non-watch semantics end to end: no stats diffing, `stateManager.testFiles`
      // stays the built set, and the plan keeps its non-watch shape. Reruns come
      // from repeated `runCycle` calls, never from file-system events.
      isWatchMode: false,
    });

    const hasNodeTestsToRun = planner.hasNodeTestsToRun();
    if (hasNodeTestsToRun) {
      await ensureRunDependencies({ projects: [], rootPath, coverage });
    }

    const coveragePluginLoadError = planner.coveragePluginLoadError();
    // A coverage-plugin load error only fails a run that has something to run;
    // with nothing to run it just means no provider can be built.
    if (hasNodeTestsToRun && coveragePluginLoadError) {
      throw coveragePluginLoadError;
    }

    // Resolved here rather than at build time because the executor takes it
    // through its constructor — one provider for the runner's whole lifetime,
    // like the single-shot run's.
    coverageProvider = coveragePluginLoadError
      ? null
      : await createCoverageProviderWithLog(coverage, rootPath);

    const { nodeBuild } = planner;
    if (!nodeBuild) {
      return { planner, nodeExecutor: undefined };
    }

    nodeBuild.rsbuildInstance.onAfterDevCompile(({ isFirstCompile, stats }) => {
      if (!isFirstCompile) {
        return;
      }
      const perEnvironment = 'stats' in stats ? stats.stats : [stats];
      resolveCompileErrors(
        perEnvironment.flatMap((environmentStats) =>
          environmentStats.compilation.errors.map((error) => error.message),
        ),
      );
    });

    const nodeExecutor = createNodeExecutor(context, {
      ...nodeBuild,
      getPlan: planner.getPlan,
      coverageProvider,
      isWatchMode: false,
      getTraceRun: () => activeTraceRun,
    });
    await nodeExecutor.init();

    return { planner, nodeExecutor };
  };

  const ensurePrepared = (): Promise<PreparedRun> => {
    preparePromise ??= prepare();
    return preparePromise;
  };

  const createBuild = async (): Promise<RunnerBuildOutput> => {
    const { planner, nodeExecutor } = await ensurePrepared();

    if (planner.hasNodeTestsToRun() && nodeExecutor) {
      await nodeExecutor.ensureRunResources();
      const errors = await compileErrors;
      if (errors.length) {
        throw new Error(`Test build failed.\n\n${errors.join('\n\n')}`);
      }
    }

    const { entriesCache } = planner.getPlan();
    return {
      testFiles: Array.from(
        new Set(
          Array.from(entriesCache.values()).flatMap((projectEntries) =>
            Object.values(projectEntries.entries),
          ),
        ),
      ),
    };
  };

  const ensureBuilt = (): Promise<RunnerBuildOutput> => {
    buildPromise ??= createBuild();
    return buildPromise;
  };

  const executeCycle = async (options: RunnerCycleOptions): Promise<void> => {
    const { testFiles } = await ensureBuilt();
    const { planner, nodeExecutor } = await ensurePrepared();

    // Resolved against the built list rather than through the executor's glob:
    // the glob is memoized at build scope, so it would answer with the built
    // set no matter what this run asks for.
    const selectedFiles = options.filters?.length
      ? filterFiles(
          testFiles,
          options.filters,
          rootPath,
          options.filterMode ?? context.fileFilterMode,
        )
      : undefined;

    // Per-run reset. `prepareWatchCycleState` covers the state a watch rerun
    // resets (the two managers and the exit code); `reporterResults` is
    // cleared on top of it because each run must report only its own files,
    // while watch deliberately accumulates them across reruns. Fresh arrays
    // rather than in-place truncation: reporters receive these arrays by
    // reference in `onTestRunEnd`.
    //
    // Never the first-cycle shape: that one exists so a mixed watch startup's
    // second executor keeps what the first just reported, and this runner's
    // runs are independent — each must start from a cleared summary and code.
    prepareWatchCycleState(context, { isFirstCycle: false });
    context.reporterResults.results = [];
    context.reporterResults.testResults = [];
    // Every run starts from a clean runtime: a kept worker flushes its loader
    // caches on a `buildId` boundary.
    buildId += 1;

    const executorToRun =
      planner.hasNodeTestsToRun() &&
      (selectedFiles === undefined || selectedFiles.length > 0)
        ? nodeExecutor
        : undefined;

    const restoreOverrides = applyRunOverrides(
      context,
      planner.getPlan().nodeProjectsToRun,
      options,
    );
    try {
      await runAndFinalizeCycle(context, {
        startCycles: () =>
          executorToRun
            ? [
                executorToRun.runCycle({
                  buildId,
                  // `on-demand` resolves entries from the watch stats diff, which
                  // a non-watch server never computes.
                  mode: 'all',
                  fileFilters: selectedFiles,
                  updateSnapshot: snapshotManager.options.updateSnapshot,
                }),
              ]
            : [],
        mode: 'all',
        isWatchMode: false,
        coverageProvider,
        reportOnFailure: coverage.reportOnFailure,
        traceRun: activeTraceRun,
      });
    } finally {
      restoreOverrides();
    }

    // `finalizeRunCycle` consumed this run's trace buffer; the next run needs
    // its own, and `close()` finalizes whichever one stays unused.
    activeTraceRun = traceController.beginRun();
  };

  const assertUsable = (): void => {
    if (closePromise) {
      throw new Error(RUNNER_CLOSED_MESSAGE);
    }
  };

  return {
    build: async () => {
      assertUsable();
      if (inFlightRun) {
        throw new Error(
          'Cannot build while a test run is in progress; wait for the run to finish.',
        );
      }
      return ensureBuilt();
    },
    runCycle: async (options = {}) => {
      assertUsable();
      if (inFlightRun) {
        throw new Error(RUNNER_BUSY_MESSAGE);
      }
      const cycle = executeCycle(options);
      // `close()` waits on this handle, so it must settle rather than reject.
      inFlightRun = cycle.catch(() => undefined);
      try {
        await cycle;
      } finally {
        inFlightRun = undefined;
      }
    },
    close: () => {
      closePromise ??= (async () => {
        // A close racing a run tears down what that run leaves behind.
        await inFlightRun;
        // A build starts the dev server and the worker pool *after* `prepare()`
        // resolves, so a close racing a build must settle that build too —
        // otherwise it releases nothing and the build brings both up unowned.
        await buildPromise?.catch(() => undefined);
        // Settle an in-flight prepare for the same reason; a failed prepare
        // built nothing to release.
        const prepared = await preparePromise?.catch(() => undefined);
        // Drained here rather than left to the executor so a failing teardown
        // reaches the host: teardown raises the exit code, but `close()` is
        // outside any cycle, so no result carries it — the rejection below is
        // the host's only signal. The executor's own drain then finds an empty
        // queue.
        const teardownSucceeded = await runLifecycleStep(
          'global teardown',
          () => runGlobalTeardown(context),
        );
        const nodeExecutor = prepared?.nodeExecutor;
        if (nodeExecutor) {
          // Owns the worker pool and the dev server.
          await runLifecycleStep('executor cleanup', () =>
            nodeExecutor.close(),
          );
        }
        await runLifecycleStep('trace run finalize', () =>
          activeTraceRun.finalize(),
        );
        await runLifecycleStep('trace controller cleanup', () =>
          traceController.close(),
        );
        // Thrown last: every resource above is released either way.
        if (!teardownSucceeded) {
          throw new Error(
            'globalSetup teardown failed; see the logged error above.',
          );
        }
      })();
      return closePromise;
    },
  };
}
