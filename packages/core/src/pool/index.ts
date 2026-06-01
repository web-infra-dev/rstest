import { readFile, unlink } from 'node:fs/promises';
import os from 'node:os';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import type { Worker } from 'node:worker_threads';
import type { SnapshotUpdateState } from '@vitest/snapshot';
import { basename, dirname, join, resolve } from 'pathe';
import { getFileTaskId } from '../runtime/runner';
import type {
  CoverageMapData,
  EntryInfo,
  FormattedError,
  ProjectContext,
  RstestContext,
  RuntimeConfig,
  RuntimeRPC,
  TestCaseInfo,
  TestFileInfo,
  TestFileResult,
  TestInfo,
  TestResult,
  TestSuiteInfo,
  UserConsoleLog,
} from '../types';
import {
  color,
  getForceColorEnv,
  isDebug,
  isDeno,
  logger,
  needFlagExperimentalDetectModule,
  toError,
} from '../utils';
import type { TraceEvent } from '../utils/trace';
import { isMemorySufficient } from '../utils/memory';
import { selectMemoryGate } from './memoryGate';
import { Pool } from './pool';
import type { PoolWorkerKind } from './types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const getNumCpus = (): number => {
  return os.availableParallelism?.() ?? os.cpus().length;
};

/**
 * Minimum number of per-file coverage payloads before end-of-run ingest is
 * offloaded to a `worker_threads` pool. Below this, the host parses the handful
 * of files itself — spinning up workers would cost more than it saves. See
 * issue #1326.
 */
const COVERAGE_MERGE_MIN_FILES = 8;

const parseWorkers = (maxWorkers: string | number): number => {
  const parsed = Number.parseInt(maxWorkers.toString(), 10);

  if (typeof maxWorkers === 'string' && maxWorkers.trim().endsWith('%')) {
    const numCpus = getNumCpus();
    const workers = Math.floor((parsed / 100) * numCpus);
    return Math.max(workers, 1);
  }

  return parsed > 0 ? parsed : 1;
};

const getRuntimeConfig = (context: ProjectContext): RuntimeConfig => {
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
  } = context.normalizedConfig;

  return {
    env: {
      // get process.env correctly when globalSetup modified it
      ...process.env,
      ...env,
    },
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
    testEnvironment,
    isolate,
    coverage: { ...coverage, reporters: [] }, // reporters may be functions so remove it
    snapshotFormat,
    logHeapUsage,
    detectAsyncLeaks,
    bail,
    chaiConfig,
    includeTaskLocation,
    silent,
  };
};

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
}) => {
  const getAssets = () =>
    filterAssetsByEntry(entryInfo, getAssetFiles, getSourceMaps, setupAssets);

  return {
    worker: workerKind,
    type,
    options: {
      entryInfo,
      context: {
        outputModule: project.outputModule,
        taskId: index + 1,
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
      assets: isMemorySufficient() ? await getAssets() : undefined,
    },
    rpcMethods: {
      ...rpcMethods,
      // getAssetsByEntry is only used when memory is not sufficient since it may be slow
      getAssetsByEntry: getAssets,
    },
  };
};

/**
 * Convert a worker crash or pool error into a fail-status `TestFileResult`.
 * Enriches the error with context about which test cases were running at the
 * time of the crash (if any).
 */
const workerErrorToResult = (
  err: unknown,
  testPath: string,
  projectName: string,
  context: RstestContext,
): TestFileResult => {
  const error = toError(err);

  (error as any).fullStack = true;
  if (error.message.includes('Worker exited unexpectedly')) {
    delete error.stack;
  }

  const runningModule = context.stateManager.runningModules.get(testPath);
  const runningTests = runningModule?.runningTests;

  if (runningTests?.length) {
    const getCaseName = (test: TestCaseInfo) =>
      `"${test.name}"${test.parentNames?.length ? ` (Under suite: ${test.parentNames?.join(' > ')})` : ''}`;

    const hint =
      runningTests.length === 1
        ? `Maybe relevant test case: ${getCaseName(runningTests[0]!)} which is running when the error occurs.`
        : `The below test cases may be relevant, as they were running when the error occurred:\n  - ${runningTests.map((t) => getCaseName(t)).join('\n  - ')}`;

    error.message += `\n\n${color.white(hint)}`;
  }

  return {
    testId: getFileTaskId(testPath),
    project: projectName,
    testPath,
    status: 'fail',
    name: '',
    results: runningModule?.results || [],
    errors: [error],
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
    /** When provided, coverage data is passed to this callback immediately for caller-owned merging. */
    onCoverageResult?: (coverage: CoverageMapData) => void;
    /** Perfetto trace events forwarded for caller-owned dumping. */
    onTraceEvents?: (events: TraceEvent[]) => void;
    /**
     * Absolute path to the coverage provider's off-main-thread merge worker.
     * When set (and enough files are produced), end-of-run coverage ingest runs
     * in a `worker_threads` pool instead of on the host event loop. See issue
     * #1326.
     */
    coverageMergeWorker?: string;
    /**
     * Whether {@link coverageMergeWorker} supports the streaming ingest
     * protocol. Gates the streaming path so a batch-only worker (e.g. v8) is
     * never driven in streaming mode. See issue #1326.
     */
    coverageMergeWorkerStreaming?: boolean;
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
  const shouldEmitUserConsoleLog = ({
    log,
    projectConfig,
  }: {
    log: UserConsoleLog;
    projectConfig: ProjectContext['normalizedConfig'];
  }): boolean => {
    return projectConfig.onConsoleLog?.(log.content) !== false;
  };

  const emitUserConsoleLog = async ({
    log,
    projectConfig,
  }: {
    log: UserConsoleLog;
    projectConfig: ProjectContext['normalizedConfig'];
  }): Promise<void> => {
    if (!shouldEmitUserConsoleLog({ log, projectConfig })) {
      return;
    }

    await Promise.all(
      reporters.map((reporter) => reporter.onUserConsoleLog?.(log)),
    );
  };

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
    reporters,
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
    ? parseWorkers(poolOptions.maxWorkers)
    : recommendCount;

  const minWorkers = poolOptions.minWorkers
    ? parseWorkers(poolOptions.minWorkers)
    : maxWorkers < recommendCount
      ? maxWorkers
      : recommendCount;

  if (maxWorkers < minWorkers) {
    throw `Invalid pool configuration: maxWorkers(${maxWorkers}) cannot be less than minWorkers(${minWorkers}).`;
  }

  // Opt-in one-shot environment banner (`DEBUG=rstest`, zero overhead
  // otherwise). Captures the run fingerprint that explains pool utilization —
  // worker kind/count, isolate, coverage provider, CPU count + loadavg, memory
  // + heap ceiling, node/platform — so a perf report (e.g. issue #1326) is
  // self-contained and we don't have to ask the reporter for CI specs.
  if (isDebug()) {
    const { coverage } = context.normalizedConfig;
    const { getHeapStatistics } = await import('node:v8');
    const mb = (bytes: number) => Math.round(bytes / 1024 / 1024);
    logger.debug(
      `pool: command=${context.command} workerKind=${workerKind} maxWorkers=${maxWorkers} minWorkers=${minWorkers} isolate=${isolate} coverage=${
        coverage?.enabled ? coverage.provider : 'disabled'
      }`,
    );
    logger.debug(
      `pool: cpus=${numCpus} (${os.cpus()[0]?.model ?? 'unknown'}) loadavg=${os
        .loadavg()
        .map((n) => n.toFixed(2))
        .join('/')} mem(free/total)=${mb(os.freemem())}/${mb(
        os.totalmem(),
      )}MB heapLimit=${mb(
        getHeapStatistics().heap_size_limit,
      )}MB node=${process.version} ${process.platform}/${process.arch}`,
    );
  }

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

  const createRpcMethods = ({
    runtimeConfig,
    projectConfig,
  }: {
    runtimeConfig: RuntimeConfig;
    projectConfig: ProjectContext['normalizedConfig'];
  }): Omit<RuntimeRPC, 'getAssetsByEntry'> => ({
    onTestCaseStart: async (test: TestCaseInfo) => {
      context.stateManager.onTestCaseStart(test);
      Promise.all(
        reporters.map((reporter) => reporter.onTestCaseStart?.(test)),
      );
    },
    onTestCaseResult: async (result: TestResult) => {
      context.stateManager.onTestCaseResult(result);
      await Promise.all(
        reporters.map((reporter) => reporter.onTestCaseResult?.(result)),
      );
    },
    getCountOfFailedTests: async (): Promise<number> => {
      return context.stateManager.getCountOfFailedTests();
    },
    onConsoleLog: async (log: UserConsoleLog) => {
      if (runtimeConfig.disableConsoleIntercept) {
        return;
      }

      await emitUserConsoleLog({ log, projectConfig });
    },
    onTestFileStart: async (test: TestFileInfo) => {
      context.stateManager.onTestFileStart(test.testPath);
      await Promise.all(
        reporters.map((reporter) => reporter.onTestFileStart?.(test)),
      );
    },
    onTestFileReady: async (test: TestFileInfo) => {
      await Promise.all(
        reporters.map((reporter) => reporter.onTestFileReady?.(test)),
      );
    },
    onTestSuiteStart: async (test: TestSuiteInfo) => {
      await Promise.all(
        reporters.map((reporter) => reporter.onTestSuiteStart?.(test)),
      );
    },
    onTestSuiteResult: async (result: TestResult) => {
      await Promise.all(
        reporters.map((reporter) => reporter.onTestSuiteResult?.(result)),
      );
    },
    resolveSnapshotPath: (testPath: string): string => {
      const snapExtension = '.snap';
      const resolver =
        projectConfig.resolveSnapshotPath ||
        // test/index.ts -> test/__snapshots__/index.ts.snap
        (() =>
          join(
            dirname(testPath),
            '__snapshots__',
            `${basename(testPath)}${snapExtension}`,
          ));

      const snapshotPath = resolver(testPath, snapExtension);
      return snapshotPath;
    },
  });

  return {
    runTests: async ({
      entries,
      getAssetFiles,
      getSourceMaps,
      setupEntries,
      project,
      updateSnapshot,
      onCoverageResult,
      onTraceEvents,
      coverageMergeWorker,
      coverageMergeWorkerStreaming,
    }) => {
      const projectName = project.name;
      const runtimeConfig = getRuntimeConfig(project);
      const rpcMethods = createRpcMethods({
        runtimeConfig,
        projectConfig: project.normalizedConfig,
      });
      const setupAssets = setupEntries.flatMap((entry) => entry.files || []);

      // [#1326] Paths to per-file coverage JSON written to disk by test workers.
      // Collected during the run (cheap) and ingested off the host event loop
      // once all workers have exited (see end-of-run block below).
      const coverageFiles: string[] = [];

      // Opt-in diagnostics (`DEBUG=rstest`). Zero overhead otherwise. Measures
      // host event-loop saturation during the run plus the end-of-run coverage
      // ingest cost, so a slow/under-utilized run can be attributed without
      // another round-trip: high event-loop delay ⇒ the host loop is the
      // bottleneck (e.g. coverage being merged inline); low delay but low CPU
      // ⇒ the cost is worker-side (instrumentation / fork churn). See #1326.
      const diag = isDebug();
      const eld = diag ? monitorEventLoopDelay({ resolution: 20 }) : undefined;
      eld?.enable();

      // [#1326 follow-up — experimental, RSTEST_COV_INGEST=stream] Streaming
      // ingest: a single long-lived merge thread consumes per-file coverage
      // paths AS THEY ARRIVE and unlinks each temp file immediately, so the
      // corpus never accumulates on disk and only ONE deduped map is ever
      // resident — vs the end-of-run fan-out which materializes the whole
      // corpus and up to N partial maps (N× amplification). The host loop still
      // only handles path strings, so utilization stays high.
      // Streaming is gated on a provider CAPABILITY flag, not the mere presence
      // of a merge worker — a batch-only worker (v8) must never be handed the
      // streaming protocol (it would crash async and silently drop coverage).
      // Default ON for capable providers; `RSTEST_COV_INGEST=batch` forces the
      // #1348 end-of-run fan-out, `=stream` is explicit opt-in.
      let streamingIngest =
        process.env.RSTEST_COV_INGEST !== 'batch' &&
        !!coverageMergeWorker &&
        coverageMergeWorkerStreaming === true;
      let streamWorker: Worker | undefined;
      let streamFinal: Promise<CoverageMapData | undefined> | undefined;
      let streamedCount = 0;
      if (streamingIngest) {
        try {
          const { Worker } = await import('node:worker_threads');
          streamWorker = new Worker(coverageMergeWorker!, {
            workerData: { streaming: true },
          });
          streamFinal = new Promise<CoverageMapData | undefined>(
            (resolveFinal, rejectFinal) => {
              let settled = false;
              streamWorker!.once('message', (m: CoverageMapData) => {
                settled = true;
                resolveFinal(m);
              });
              streamWorker!.once('error', (e) => {
                settled = true;
                rejectFinal(e);
              });
              // Unlike the #1348 fan-out, register `exit` too: a worker that
              // dies without posting (OOM-kill, load failure) can never orphan
              // the awaiter — it rejects instead of hanging forever.
              streamWorker!.once('exit', (code) => {
                if (!settled)
                  rejectFinal(
                    new Error(`coverage merge worker exited (code ${code})`),
                  );
              });
            },
          );
        } catch {
          // worker_threads unavailable / merge worker failed to load: fall back
          // to the batch path by collecting paths into `coverageFiles`.
          streamingIngest = false;
        }
      }

      const results = await Promise.all(
        entries.map(async (entryInfo, index) => {
          const task = await buildTask({
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
          });

          const result = await pool.runTest(task).catch((err: unknown) => {
            return workerErrorToResult(
              err,
              entryInfo.testPath,
              projectName,
              context,
            );
          });

          // [#1326] When the provider supports it, the worker shipped only a
          // path to its on-disk coverage; collect it (cheap) and defer all
          // read + parse + merge to end-of-run, off the scheduling loop, so no
          // per-file coverage graph is deserialized on the host during the run.
          const covFile = result.coverageFile;
          if (covFile) {
            if (streamingIngest && streamWorker) {
              // Hand the path to the long-lived consumer immediately (cheap —
              // the host only posts a string; the worker reads+merges+unlinks).
              streamWorker.postMessage({ type: 'file', path: covFile });
              streamedCount++;
            } else {
              coverageFiles.push(covFile);
            }
            delete result.coverageFile;
          }
          if (result.coverage) {
            onCoverageResult?.(result.coverage);
            delete result.coverage;
          }
          if (result.traceEvents) {
            onTraceEvents?.(result.traceEvents);
            delete result.traceEvents;
          }
          context.stateManager.onTestFileResult(result);
          reporters.map((reporter) => reporter.onTestFileResult?.(result));
          return result;
        }),
      );

      if (diag && eld) {
        eld.disable();
        const ms = (ns: number) => (ns / 1e6).toFixed(1);
        logger.debug(
          `pool(${projectName}): host event-loop delay during run — mean=${ms(eld.mean)}ms p99=${ms(eld.percentile(99))}ms max=${ms(eld.max)}ms (high p99/max ⇒ the host loop is the bottleneck)`,
        );
      }

      // [#1326 follow-up] Streaming ingest: most merging already happened during
      // the run; just drain the consumer's small backlog, take the single
      // merged map, and tear it down. No corpus on disk, no N× amplification.
      if (streamingIngest && streamWorker && streamFinal) {
        const ingestStart = diag ? performance.now() : 0;
        streamWorker.postMessage({ type: 'done' });
        const finalMap = await streamFinal.catch((error) => {
          // The streaming consumer already unlinked the temp files it merged, so
          // we cannot fall back to a batch re-read here. Surface a real WARNING
          // (not a debug-only line) so a partial/empty coverage report is never
          // silent — the user can re-run with RSTEST_COV_INGEST=batch.
          logger.warn(
            `coverage(${projectName}): streaming ingest failed (${
              toError(error).message
            }) — coverage for this project may be incomplete. Re-run with RSTEST_COV_INGEST=batch to use the end-of-run merge.`,
          );
          return undefined;
        });
        if (finalMap) {
          onCoverageResult?.(finalMap);
        }
        await streamWorker.terminate();
        if (diag) {
          logger.debug(
            `coverage(${projectName}): ingest strategy=streaming files=${streamedCount} took=${(performance.now() - ingestStart).toFixed(0)}ms (drain tail)`,
          );
        }
      } else if (coverageFiles.length) {
        // [#1326] Off-main-thread coverage ingest. All test workers have exited
        // (Promise.all resolved), so reading + parsing + merging the per-file
        // coverage now runs off the scheduling critical path — a terminal tail,
        // not a during-run plateau. With a provider-supplied merge worker, the
        // expensive JSON.parse runs in a worker_threads pool and only a few small
        // merged partials cross back to the host.
        const ingestStart = diag ? performance.now() : 0;
        let ingestStrategy: 'worker-threads' | 'main-thread' = 'main-thread';
        let ingestThreads = 0;
        let ingested = false;
        if (
          coverageMergeWorker &&
          coverageFiles.length >= COVERAGE_MERGE_MIN_FILES
        ) {
          try {
            const { Worker } = await import('node:worker_threads');
            const threadCount = Math.min(getNumCpus(), coverageFiles.length);
            ingestThreads = threadCount;
            const chunks: string[][] = Array.from(
              { length: threadCount },
              () => [],
            );
            coverageFiles.forEach((file, i) =>
              chunks[i % threadCount]!.push(file),
            );
            const partials = await Promise.all(
              chunks
                .filter((chunk) => chunk.length)
                .map(
                  (files) =>
                    new Promise<CoverageMapData>(
                      (resolveChunk, rejectChunk) => {
                        const worker = new Worker(coverageMergeWorker, {
                          workerData: { files },
                        });
                        worker.once('message', (partial: CoverageMapData) => {
                          worker.terminate();
                          resolveChunk(partial);
                        });
                        worker.once('error', rejectChunk);
                      },
                    ),
                ),
            );
            for (const partial of partials) {
              onCoverageResult?.(partial);
            }
            ingestStrategy = 'worker-threads';
            ingested = true;
          } catch (error) {
            // worker_threads unavailable or the merge worker failed to load:
            // fall back to a host-side parse of the same files below.
            logger.debug(
              `coverage(${projectName}): worker-threads ingest failed (${
                toError(error).message
              }) — falling back to main-thread parse`,
            );
          }
        }
        if (!ingested) {
          const parsed = await Promise.all(
            coverageFiles.map(
              async (file) =>
                JSON.parse(await readFile(file, 'utf8')) as CoverageMapData,
            ),
          );
          for (const coverage of parsed) {
            onCoverageResult?.(coverage);
          }
        }
        await Promise.all(
          coverageFiles.map((file) => unlink(file).catch(() => {})),
        );
        if (diag) {
          logger.debug(
            `coverage(${projectName}): ingest strategy=${ingestStrategy}` +
              `${ingestStrategy === 'worker-threads' ? ` threads=${ingestThreads}` : ''}` +
              ` files=${coverageFiles.length} took=${(performance.now() - ingestStart).toFixed(0)}ms`,
          );
        }
      }

      for (const result of results) {
        if (result.snapshotResult) {
          context.snapshotManager.add(result.snapshotResult);
        }
      }

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
      const rpcMethods = createRpcMethods({
        runtimeConfig,
        projectConfig: project.normalizedConfig,
      });
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
