import { fileURLToPath } from 'node:url';
import type { SnapshotUpdateState } from '@vitest/snapshot';
import { dirname, join, resolve } from 'pathe';
import type {
  CoverageMapData,
  EntryInfo,
  FormattedError,
  ProjectContext,
  RstestContext,
  RuntimeConfig,
  RuntimeRPC,
  TestCaseInfo,
  TestFileResult,
  TestInfo,
  TestResult,
  TestEnvironmentModuleReference,
} from '../types';
import {
  color,
  getFileTaskId,
  getForceColorEnv,
  isDeno,
  logger,
  needFlagExperimentalDetectModule,
  toError,
} from '../utils';
import { type TraceEvent, type TraceSpan, noopTraceSpan } from '../utils/trace';
import { isMemorySufficient } from '../utils/memory';
import { getNumCpus, parseMemoryLimit, parseWorkers } from '../utils/workers';
import { selectMemoryGate } from './memoryGate';
import { getEnvironmentKey } from '../core/environmentGroups';
import { formatTestEnvironmentPrebundleFallbackWarning } from '../core/envDependencies';
import { projectRuntimeConfig } from '../core/runtimeConfigProjection';
import { prepareAssetFilesForIPC } from '../utils/assetFiles';
import {
  type BundleCoverageResult,
  isBundleCoverageDebugEnabled,
} from '../core/bundleCoverage';
import {
  createRunnerEventSink,
  type RunnerEventSink,
  sinkToRuntimeRpc,
} from '../core/runnerEventSink';
import { Pool } from './pool';
import type { PoolTask, PoolWorkerKind } from './types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const getRuntimeConfig = (context: ProjectContext): RuntimeConfig =>
  projectRuntimeConfig(context, { envMode: 'inherit' });

const VM_ASSET_CACHE_MAX_BYTES = 64 * 1024 * 1024;

const getVmAssetCacheLimit = (
  memoryLimit: number | undefined,
): number | undefined =>
  memoryLimit === undefined
    ? undefined
    : Math.min(VM_ASSET_CACHE_MAX_BYTES, Math.floor(memoryLimit / 4));

const getAssetNames = (
  entryInfo: EntryInfo,
  setupAssets: string[],
  allAssetNames: string[] | undefined,
  federation: boolean,
): string[] => {
  const entryAssetNames =
    federation && allAssetNames
      ? allAssetNames.filter((name) => !name.endsWith('.map'))
      : entryInfo.files!;

  return Array.from(new Set([...entryAssetNames, ...setupAssets]));
};

const getNodeExecArgv = () => {
  const suppressFile = join(__dirname, './rstestSuppressWarnings.cjs');

  return [
    '--experimental-vm-modules',
    '--experimental-import-meta-resolve',
    needFlagExperimentalDetectModule()
      ? '--experimental-detect-module'
      : undefined,
    '--require',
    suppressFile,
  ].filter(Boolean) as string[];
};

/** Shared parameter type for `runTests` and `collectTests`. */
type PoolDispatchParams = {
  entries: EntryInfo[];
  assetNames: string[];
  getAssetFiles: (names: string[]) => Promise<Record<string, Buffer>>;
  getSourceMaps: (names: string[]) => Promise<Record<string, string>>;
  setupEntries: EntryInfo[];
  updateSnapshot: SnapshotUpdateState;
  project: ProjectContext;
  /** Per-compile id threaded to the worker for rebuild-boundary cache flushing (#1373). Defaults to `0`. */
  buildId?: number;
};

/**
 * Build a `PoolTask` for a single entry.  Shared by `runTests` and
 * `collectTests` so the option-assembly logic lives in one place.
 */
const buildTask = async ({
  type,
  workerKind,
  entryInfo,
  index,
  context,
  project,
  runtimeConfig,
  setupEntries,
  setupAssets,
  assetNames,
  updateSnapshot,
  getAssetFiles,
  getSourceMaps,
  rpcMethods,
  traceSpan,
  testEnvironmentModule,
  buildId = 0,
  assetCacheLimit,
  captureBundleCoverage = false,
}: {
  type: 'run' | 'collect';
  workerKind: PoolWorkerKind;
  entryInfo: EntryInfo;
  index: number;
  context: RstestContext;
  project: ProjectContext;
  runtimeConfig: RuntimeConfig;
  setupEntries: EntryInfo[];
  setupAssets: string[];
  assetNames: string[];
  updateSnapshot: SnapshotUpdateState;
  getAssetFiles: PoolDispatchParams['getAssetFiles'];
  getSourceMaps: PoolDispatchParams['getSourceMaps'];
  rpcMethods: Omit<RuntimeRPC, 'getAssetsByEntry'>;
  traceSpan: TraceSpan;
  testEnvironmentModule?: TestEnvironmentModuleReference;
  buildId?: number;
  assetCacheLimit?: number;
  captureBundleCoverage?: boolean;
}): Promise<{
  task: PoolTask;
  bundleCoverageAssets?: Record<string, number>;
}> => {
  const bundleCoverageAssets: Record<string, number> | undefined =
    captureBundleCoverage ? {} : undefined;
  const taskAssetNames = getAssetNames(
    entryInfo,
    setupAssets,
    assetNames,
    project.normalizedConfig.federation,
  );
  const getAssets = async (
    requestedAssetNames = taskAssetNames,
    requestedSourceMapNames = requestedAssetNames,
  ) => {
    const [neededFiles, neededSourceMaps] = await Promise.all([
      getAssetFiles(requestedAssetNames),
      getSourceMaps(requestedSourceMapNames),
    ]);
    const assets = {
      assetFiles: neededFiles,
      sourceMaps: neededSourceMaps,
    };
    if (bundleCoverageAssets) {
      for (const [name, content] of Object.entries(assets.assetFiles)) {
        bundleCoverageAssets[name] = content.byteLength;
      }
    }
    return {
      ...assets,
      assetFiles: prepareAssetFilesForIPC(assets.assetFiles, workerKind),
    };
  };
  const traceArgs = {
    project: project.name,
    testPath: entryInfo.testPath,
    type,
  };

  return {
    task: {
      worker: workerKind,
      type,
      options: {
        entryInfo,
        assetNames: taskAssetNames,
        // Known limit: the config portion is `stableJson`, so environment option
        // values JSON cannot express (an `html` ArrayBuffer, a `beforeParse`
        // function, a `virtualConsole` instance) collapse to identical bytes —
        // two projects differing only in such values may share a worker's
        // environment under `isolate: false`. Accepted as too narrow to guard;
        // if it ever matters, fall back to a project-scoped key when the config
        // is not JSON-representable instead of trying to serialize those values.
        environmentKey: getEnvironmentKey(
          runtimeConfig.testEnvironment,
          testEnvironmentModule,
        ),
        context: {
          outputModule: project.outputModule,
          taskId: index + 1,
          buildId,
          project: project.name,
          pool: workerKind,
          rootPath: context.rootPath,
          projectRoot: project.rootPath,
          runtimeConfig,
          testEnvironmentModule,
          assetCacheLimit,
          trace: context.trace,
        },
        type,
        setupEntries,
        updateSnapshot,
        // Federation entries need the complete compilation asset map. Fetch it
        // when a worker starts the task so concurrent task preparation cannot
        // retain one full copy per test entry. vmThreads deliberately uses the
        // lazy path below so each worker can cache shared assets by name.
        assets:
          workerKind !== 'vmThreads' &&
          isMemorySufficient() &&
          !project.normalizedConfig.federation
            ? await traceSpan('host:get-assets-by-entry', 'host', getAssets, {
                ...traceArgs,
                mode: 'eager',
              })
            : undefined,
      },
      rpcMethods: {
        ...rpcMethods,
        // vmThreads uses this path for its per-worker asset cache; other pools
        // use it when eager host-side asset delivery is not safe.
        getAssetsByEntry: (requestedAssetNames, requestedSourceMapNames) =>
          traceSpan(
            'host:get-assets-by-entry',
            'host',
            () => getAssets(requestedAssetNames, requestedSourceMapNames),
            { ...traceArgs, mode: 'rpc' },
          ),
      },
    },
    bundleCoverageAssets,
  };
};

/**
 * Convert a worker crash or pool error into a fail-status `TestFileResult`.
 * Enriches the error with context about which test cases were running at the
 * time of the crash (if any).
 *
 * Returns the file result plus the synthetic `crashedResults` (the cases that
 * were running at crash time). The caller replays those through the live
 * `onTestCaseResult` reporter hook so incremental reporters stay consistent
 * with the final totals — they are already included in `fileResult.results`.
 */
const workerErrorToResult = (
  err: unknown,
  testPath: string,
  projectName: string,
  context: RstestContext,
): { fileResult: TestFileResult; crashedResults: TestResult[] } => {
  const error = toError(err);

  (error as any).fullStack = true;
  if (error.message.includes('Worker exited unexpectedly')) {
    delete error.stack;
  }

  const runningModule = context.stateManager.runningModules.get(testPath);
  const runningTests = runningModule?.runningTests;
  const completedResults = runningModule?.results || [];

  let results = completedResults;
  let crashedResults: TestResult[] = [];
  // The crash error stays at the file level unless we can attribute it to a
  // running case below, in which case it moves onto that case.
  let errors = [error];

  // When the worker dies mid-test, attribute the crash to the test case(s) that
  // were running so they surface as failed test cases in the `Tests` totals,
  // instead of the case silently vanishing from the counts (#1535).
  if (runningTests?.length) {
    const getCaseName = (test: TestCaseInfo) =>
      `"${test.name}"${test.parentNames?.length ? ` (Under suite: ${test.parentNames?.join(' > ')})` : ''}`;

    const hint =
      runningTests.length === 1
        ? `Maybe relevant test case: ${getCaseName(runningTests[0]!)} which is running when the error occurs.`
        : `The below test cases may be relevant, as they were running when the error occurred:\n  - ${runningTests.map((t) => getCaseName(t)).join('\n  - ')}`;

    error.message += `\n\n${color.white(hint)}`;

    crashedResults = runningTests.map((test) => ({
      testId: test.testId,
      status: 'fail',
      name: test.name,
      testPath: test.testPath,
      parentNames: test.parentNames,
      project: test.project,
      errors: [error],
    }));

    results = [...completedResults, ...crashedResults];
    // The error is attributed to the crashed case(s) above; keep it off the
    // file-level result so the failing-tests summary doesn't print it twice.
    errors = [];
  }

  return {
    fileResult: {
      testId: getFileTaskId(testPath),
      project: projectName,
      testPath,
      status: 'fail',
      name: '',
      results,
      errors,
    },
    crashedResults,
  };
};

export const createPool = async ({
  context,
  testEnvironmentModules,
}: {
  context: RstestContext;
  testEnvironmentModules?: ReadonlyMap<string, TestEnvironmentModuleReference>;
}): Promise<{
  runTests: (params: {
    entries: EntryInfo[];
    assetNames: string[];
    getAssetFiles: (names: string[]) => Promise<Record<string, Buffer>>;
    getSourceMaps: (names: string[]) => Promise<Record<string, string>>;
    setupEntries: EntryInfo[];
    updateSnapshot: SnapshotUpdateState;
    project: ProjectContext;
    /** Per-compile id; bumped on each watch rebuild so reused workers flush their kept module cache. */
    buildId?: number;
    /** When provided, coverage data is passed to this callback immediately for caller-owned merging. */
    onCoverageResult?: (coverage: CoverageMapData) => void;
    onRawCoverageResult?: (coverage: unknown) => void;
    /** Perfetto trace events forwarded for caller-owned dumping. */
    onTraceEvents?: (events: TraceEvent[]) => void;
    /** Records host-side pool slices in the caller-owned Perfetto trace. */
    traceSpan: TraceSpan;
  }) => Promise<{
    results: TestFileResult[];
    testResults: TestResult[];
    bundleCoverage: BundleCoverageResult[];
  }>;
  collectTests: (params: PoolDispatchParams) => Promise<
    {
      tests: TestInfo[];
      testPath: string;
      errors?: FormattedError[];
      project: string;
    }[]
  >;
  /**
   * Tear down worker-scoped fixtures before a one-shot run is finalized.
   * Watch mode keeps workers alive across cycles and owns this at shutdown.
   */
  cleanupWorkerFixtures: () => Promise<Error[]>;
  /** Drain errors from reusable workers retired during a watch cycle. */
  drainWorkerStopErrors: () => Promise<Error[]>;
  close: () => Promise<void>;
}> => {
  // Propagate parent execArgv to workers, except flags known to cause issues
  // in child processes (--prof writes per-worker profiling logs, --title is
  // meaningless for workers). Safe for child_process.fork; the referenced
  // Node.js issue (#41103) only affects worker_threads.
  // https://github.com/nodejs/node/issues/41103
  const blockedFlags = ['--prof', '--title'];
  const execArgv = process.execArgv.filter((arg, i, arr) => {
    if (blockedFlags.some((f) => arg === f || arg.startsWith(`${f}=`))) {
      return false;
    }
    // skip standalone value following --title (handles `--title foo` form)
    if (i > 0 && arr[i - 1] === '--title') {
      return false;
    }
    return true;
  });

  const numCpus = getNumCpus();

  const {
    normalizedConfig: { pool: poolOptions, isolate },
  } = context;

  const workerKind: PoolWorkerKind = poolOptions.type ?? 'forks';

  const recommendCount =
    context.command === 'watch'
      ? Math.max(Math.floor(numCpus / 2), 1)
      : Math.max(numCpus - 1, 1);

  const maxWorkers = poolOptions.maxWorkers
    ? parseWorkers(poolOptions.maxWorkers, numCpus)
    : recommendCount;

  // Internal idle-runner floor for `isolate: false`. It is not user-tunable
  // (no public `pool.minWorkers`), so it can never exceed `maxWorkers`.
  const minWorkers = Math.min(maxWorkers, recommendCount);
  const memoryLimit =
    workerKind === 'vmThreads'
      ? parseMemoryLimit(poolOptions.memoryLimit ?? 1 / maxWorkers)
      : undefined;
  const assetCacheLimit =
    workerKind === 'vmThreads' ? getVmAssetCacheLimit(memoryLimit) : undefined;

  const pool = new Pool({
    workerEntry: resolve(__dirname, './worker.js'),
    // VM threads amortize worker startup while recreating the VM realm for
    // every file. The runtime still receives the user's isolate value so it
    // can preserve file-level cleanup semantics.
    isolate: workerKind === 'vmThreads' ? false : isolate,
    // VM contexts can retain module and realm allocations until their worker
    // exits. Recycle from the worker's own V8 heap report, like Jest and
    // Vitest, while keeping the worker alive below the limit. The default
    // gives each VM worker an equal share of the machine memory.
    memoryLimit,
    maxWorkers,
    minWorkers,
    execArgv: [
      ...(poolOptions?.execArgv ?? []),
      ...execArgv,
      ...(isDeno ? [] : getNodeExecArgv()),
    ],
    env: {
      NODE_ENV: 'test',
      ...getForceColorEnv(),
      ...process.env,
    } as Record<string, string>,
    memoryGate: selectMemoryGate(workerKind),
    onTestEnvironmentFallback: ({ packageName, reason }) => {
      logger.warn(
        formatTestEnvironmentPrebundleFallbackWarning(packageName, reason),
      );
    },
  });

  const createProjectSink = (project: ProjectContext): RunnerEventSink =>
    createRunnerEventSink(context, project.normalizedConfig);
  const captureBundleCoverage = isBundleCoverageDebugEnabled();

  return {
    runTests: async ({
      entries,
      assetNames,
      getAssetFiles,
      getSourceMaps,
      setupEntries,
      project,
      updateSnapshot,
      buildId,
      onCoverageResult,
      onRawCoverageResult,
      onTraceEvents,
      traceSpan,
    }) => {
      const projectName = project.name;
      const runtimeConfig = getRuntimeConfig(project);
      const sink = createProjectSink(project);
      const rpcMethods = sinkToRuntimeRpc(sink);
      const setupAssets = setupEntries.flatMap((entry) => entry.files || []);

      // Sequential dispatch gate: `entries` is already perf-sorted, but the
      // per-entry `buildTask` (eager asset reads) finishes out of order, so
      // enqueueing right after it would scramble the pool's slot order. Each
      // entry waits for the previous one to claim its pool slot before calling
      // `pool.runTest`, then releases the next — the asset reads stay fully
      // pipelined, only the enqueue is serialized.
      let dispatchGate: Promise<void> = Promise.resolve();

      const results = await Promise.all(
        entries.map(async (entryInfo, index) => {
          const gate = dispatchGate;
          let releaseGate!: () => void;
          dispatchGate = new Promise<void>((r) => {
            releaseGate = r;
          });

          try {
            const traceArgs = {
              project: projectName,
              testPath: entryInfo.testPath,
            };
            const { task, bundleCoverageAssets } = await traceSpan(
              'host:build-task',
              'host',
              () =>
                buildTask({
                  type: 'run',
                  workerKind,
                  entryInfo,
                  index,
                  context,
                  project,
                  runtimeConfig,
                  setupEntries,
                  setupAssets,
                  assetNames,
                  updateSnapshot,
                  getAssetFiles,
                  getSourceMaps,
                  rpcMethods,
                  traceSpan,
                  testEnvironmentModule: testEnvironmentModules?.get(
                    project.environmentName,
                  ),
                  buildId,
                  assetCacheLimit,
                  captureBundleCoverage,
                }),
              traceArgs,
            );

            await gate;
            // `pool.runTest` claims a slot (or parks in `slotWaiters`)
            // synchronously before its first await, and `traceSpan` invokes
            // its callback synchronously, so releasing after this returns
            // preserves the exact enqueue order.
            const resultPromise = traceSpan(
              'host:pool-run-test',
              'host',
              () => pool.runTest(task),
              { ...traceArgs, worker: task.worker },
            );
            releaseGate();

            const result = await resultPromise.catch(async (err: unknown) => {
              const { fileResult, crashedResults } = workerErrorToResult(
                err,
                entryInfo.testPath,
                projectName,
                context,
              );
              // Each crashed case already fired `onTestCaseStart`; complete the
              // pair with a live `onTestCaseResult` so incremental reporters
              // (dot, custom accounting) render it, matching the final totals.
              // Counting stays sourced from `fileResult.results`, so the state
              // manager is intentionally not touched here to avoid
              // double-counting.
              for (const caseResult of crashedResults) {
                await Promise.all(
                  context.reporters.map((reporter) =>
                    reporter.onTestCaseResult?.(caseResult),
                  ),
                );
              }
              return fileResult;
            });

            if (result.coverage) {
              onCoverageResult?.(result.coverage);
              delete result.coverage;
            }
            const bundleCoverage: BundleCoverageResult | undefined =
              bundleCoverageAssets
                ? {
                    project: projectName,
                    testPath: entryInfo.testPath,
                    assets: bundleCoverageAssets,
                    rawV8: result.coverageRaw ?? null,
                  }
                : undefined;
            if (result.coverageRaw != null) {
              onRawCoverageResult?.(result.coverageRaw);
              delete result.coverageRaw;
            }
            if (result.traceEvents) {
              onTraceEvents?.(result.traceEvents);
              delete result.traceEvents;
            }
            await sink.onTestFileResult(result);
            return { result, bundleCoverage };
          } finally {
            // Unblock the next entry even if `buildTask` threw before the
            // dispatch above ran — otherwise the whole chain would deadlock.
            // A second call after the in-`try` release is a harmless no-op
            // (a Promise's resolve settles once).
            releaseGate();
          }
        }),
      );

      const fileResults = results.map(({ result }) => result);
      const testResults = fileResults.flatMap((r) => r.results);

      return {
        results: fileResults,
        testResults,
        project,
        bundleCoverage: results.flatMap(({ bundleCoverage }) =>
          bundleCoverage ? [bundleCoverage] : [],
        ),
      };
    },
    collectTests: async ({
      entries,
      assetNames,
      getAssetFiles,
      getSourceMaps,
      setupEntries,
      project,
      updateSnapshot,
    }) => {
      const runtimeConfig = getRuntimeConfig(project);
      const projectName = project.normalizedConfig.name;
      const rpcMethods = sinkToRuntimeRpc(createProjectSink(project));
      const setupAssets = setupEntries.flatMap((entry) => entry.files || []);

      return Promise.all(
        entries.map(async (entryInfo, index) => {
          const { task } = await buildTask({
            type: 'collect',
            workerKind,
            entryInfo,
            index,
            context,
            project,
            runtimeConfig,
            setupEntries,
            setupAssets,
            assetNames,
            updateSnapshot,
            getAssetFiles,
            getSourceMaps,
            rpcMethods,
            // `collect` does not participate in tracing.
            traceSpan: noopTraceSpan,
            testEnvironmentModule: testEnvironmentModules?.get(
              project.environmentName,
            ),
            assetCacheLimit,
          });

          return pool.collectTests(task).catch((err: FormattedError) => {
            err.fullStack = true;
            return {
              project: projectName,
              testPath: entryInfo.testPath,
              tests: [],
              errors: [err],
            };
          });
        }),
      );
    },
    cleanupWorkerFixtures: () => pool.cleanupWorkerFixtures(),
    drainWorkerStopErrors: () => pool.drainWorkerStopErrors(),
    close: () => pool.close(),
  };
};
