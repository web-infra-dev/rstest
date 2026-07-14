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
} from '../types';
import {
  color,
  getFileTaskId,
  getForceColorEnv,
  isDeno,
  needFlagExperimentalDetectModule,
  toError,
} from '../utils';
import { type TraceEvent, type TraceSpan, noopTraceSpan } from '../utils/trace';
import { isMemorySufficient } from '../utils/memory';
import { getNumCpus, parseWorkers } from '../utils/workers';
import { selectMemoryGate } from './memoryGate';
import { projectRuntimeConfig } from '../core/runtimeConfigProjection';
import {
  createRunnerEventSink,
  type RunnerEventSink,
  sinkToRuntimeRpc,
} from '../core/runnerEventSink';
import { Pool } from './pool';
import type { PoolWorkerKind } from './types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const getRuntimeConfig = (context: ProjectContext): RuntimeConfig =>
  projectRuntimeConfig(context, { envMode: 'inherit' });

const filterAssetsByEntry = async (
  entryInfo: EntryInfo,
  getAssetFiles: (names: string[]) => Promise<Record<string, string>>,
  getSourceMaps: (names: string[]) => Promise<Record<string, string>>,
  setupAssets: string[],
) => {
  const assetNames = Array.from(new Set([...entryInfo.files!, ...setupAssets]));
  const [neededFiles, neededSourceMaps] = await Promise.all([
    getAssetFiles(assetNames),
    getSourceMaps(assetNames),
  ]);

  return { assetFiles: neededFiles, sourceMaps: neededSourceMaps };
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
  getAssetFiles: (names: string[]) => Promise<Record<string, string>>;
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
  updateSnapshot,
  getAssetFiles,
  getSourceMaps,
  rpcMethods,
  traceSpan,
  buildId = 0,
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
  updateSnapshot: SnapshotUpdateState;
  getAssetFiles: PoolDispatchParams['getAssetFiles'];
  getSourceMaps: PoolDispatchParams['getSourceMaps'];
  rpcMethods: Omit<RuntimeRPC, 'getAssetsByEntry'>;
  traceSpan: TraceSpan;
  buildId?: number;
}) => {
  const getAssets = () =>
    filterAssetsByEntry(entryInfo, getAssetFiles, getSourceMaps, setupAssets);
  const traceArgs = {
    project: project.name,
    testPath: entryInfo.testPath,
    type,
  };

  return {
    worker: workerKind,
    type,
    options: {
      entryInfo,
      context: {
        outputModule: project.outputModule,
        taskId: index + 1,
        buildId,
        project: project.name,
        rootPath: context.rootPath,
        projectRoot: project.rootPath,
        runtimeConfig,
        trace: context.trace,
      },
      type,
      setupEntries,
      updateSnapshot,
      /** assets is only defined when memory is sufficient, otherwise we should get them via rpc getAssetsByEntry method */
      assets: isMemorySufficient()
        ? await traceSpan('host:get-assets-by-entry', 'host', getAssets, {
            ...traceArgs,
            mode: 'eager',
          })
        : undefined,
    },
    rpcMethods: {
      ...rpcMethods,
      // getAssetsByEntry is only used when memory is not sufficient since it may be slow
      getAssetsByEntry: () =>
        traceSpan('host:get-assets-by-entry', 'host', getAssets, {
          ...traceArgs,
          mode: 'rpc',
        }),
    },
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
  recommendWorkerCount = Number.POSITIVE_INFINITY,
}: {
  context: RstestContext;
  recommendWorkerCount?: number;
}): Promise<{
  runTests: (params: {
    entries: EntryInfo[];
    getAssetFiles: (names: string[]) => Promise<Record<string, string>>;
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
  }>;
  collectTests: (params: PoolDispatchParams) => Promise<
    {
      tests: TestInfo[];
      testPath: string;
      errors?: FormattedError[];
      project: string;
    }[]
  >;
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

  const threadsCount =
    context.command === 'watch'
      ? Math.max(Math.floor(numCpus / 2), 1)
      : Math.max(numCpus - 1, 1);

  // Avoid creating unused workers when the number of tests is less than the default thread count.
  const recommendCount =
    context.command === 'watch'
      ? threadsCount
      : Math.min(recommendWorkerCount, threadsCount);

  const maxWorkers = poolOptions.maxWorkers
    ? parseWorkers(poolOptions.maxWorkers, numCpus)
    : recommendCount;

  // Internal idle-runner floor for `isolate: false`. It is not user-tunable
  // (no public `pool.minWorkers`), so it can never exceed `maxWorkers`.
  const minWorkers = Math.min(maxWorkers, recommendCount);

  const pool = new Pool({
    workerEntry: resolve(__dirname, './worker.js'),
    isolate,
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
  });

  const createProjectSink = (project: ProjectContext): RunnerEventSink =>
    createRunnerEventSink(context, project.normalizedConfig);

  return {
    runTests: async ({
      entries,
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
            const task = await traceSpan(
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
                  updateSnapshot,
                  getAssetFiles,
                  getSourceMaps,
                  rpcMethods,
                  traceSpan,
                  buildId,
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
            if (result.coverageRaw != null) {
              onRawCoverageResult?.(result.coverageRaw);
              delete result.coverageRaw;
            }
            if (result.traceEvents) {
              onTraceEvents?.(result.traceEvents);
              delete result.traceEvents;
            }
            await sink.onTestFileResult(result);
            return result;
          } finally {
            // Unblock the next entry even if `buildTask` threw before the
            // dispatch above ran — otherwise the whole chain would deadlock.
            // A second call after the in-`try` release is a harmless no-op
            // (a Promise's resolve settles once).
            releaseGate();
          }
        }),
      );

      const testResults = results.flatMap((r) => r.results);

      return { results, testResults, project };
    },
    collectTests: async ({
      entries,
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
          const task = await buildTask({
            type: 'collect',
            workerKind,
            entryInfo,
            index,
            context,
            project,
            runtimeConfig,
            setupEntries,
            setupAssets,
            updateSnapshot,
            getAssetFiles,
            getSourceMaps,
            rpcMethods,
            // `collect` does not participate in tracing.
            traceSpan: noopTraceSpan,
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
    close: () => pool.close(),
  };
};
