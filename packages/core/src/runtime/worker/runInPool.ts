import type { FileCoverageData } from 'istanbul-lib-coverage';
import { isMainThread, threadId } from 'node:worker_threads';
import { install } from 'source-map-support';
import type {
  MaybePromise,
  Rstest,
  RunWorkerOptions,
  TestFileResult,
  TestInfo,
  WorkerState,
} from '../../types';
import { globalApis, RSTEST_API_GLOBAL_KEY } from '../../utils/constants';
import { formatError, getFileTaskId } from '../../utils/helper';
import { color } from '../../utils/logger';
import { formatTestError, getRealTimers, setRealTimers } from '../util';
import { createAsyncLeakDetector } from './asyncLeaks';
import { environmentLoaders } from './env/registry';
import { PhaseTracker } from './phaseTracker';
import { createRuntimeRpc, createWorkerRpcOptions } from './rpc';
import { createSilentConsoleController } from './silentConsole';
import { RstestSnapshotEnvironment } from './snapshot';
import { createNodeTaskContext } from './taskContext.node';
import type { TaskContext } from './taskContext';

let sourceMaps: Record<string, string> = {};

// Threads-pool workers all share `process.pid` with the host, and each
// worker_thread has its own JS context, so PhaseTracker's `nextThreadId`
// restarts at 1 inside every thread. Without a synthetic pid the merged
// Perfetto trace would collapse multiple threads onto the same `(pid, tid)`
// track and misattribute timing. Forks workers run as the main thread of a
// child_process and keep the real `process.pid`.
const tracePid = isMainThread ? undefined : process.pid * 1_000_000 + threadId;

// provides source map support for stack traces
install({
  environment: 'node',
  handleUncaughtExceptions: false,
  retrieveSourceMap: (source) => {
    if (sourceMaps[source]) {
      return {
        url: source,
        map: JSON.parse(sourceMaps[source]),
      };
    }
    return null;
  },
});

const registerGlobalApi = (api: Rstest) => {
  return globalApis.reduce<{
    [key in keyof Rstest]?: Rstest[key];
  }>((apis, key) => {
    // @ts-expect-error register to global
    globalThis[key] = api[key] as any;
    return apis;
  }, {});
};

const globalCleanups: (() => void)[] = [];
let isTeardown = false;
/**
 * Last per-compile `buildId` this (possibly reused) worker loaded; a change
 * means a watch rebuild and triggers a full cache flush below (#1373).
 *
 * Invariant the `isolate: false` cache sharing rests on: `buildId` is a single
 * `run()`-scoped counter shared by every concurrently-dispatched project, so a
 * reused worker serving project A→B→A within one round sees an identical
 * `buildId` for all of them — the full flush fires exactly once per rebuild,
 * never spuriously between sibling projects. If `buildId` ever became
 * per-project, this single module-global would ping-pong between concurrent
 * projects on a reused worker and flush mid-round, evicting a sibling's live
 * runtime chunk and reintroducing the cross-project regression (#1376).
 */
let lastBuildId: number | undefined;

const setErrorName = (error: Error, type: string): Error => {
  try {
    error.name = type;
    return error;
  } catch {
    try {
      Object.defineProperty(error, 'name', {
        value: type,
        configurable: true,
      });
      return error;
    } catch {
      const fallbackError = new Error(error.message);
      fallbackError.name = type;
      fallbackError.stack = error.stack;
      return fallbackError;
    }
  }
};

const setupEnv = (env?: Partial<NodeJS.ProcessEnv>) => {
  if (env) {
    Object.entries(env).forEach(([key, value]) => {
      if (value === undefined) {
        Reflect.deleteProperty(process.env, key);
      } else {
        process.env[key] = value;
      }
    });
  }
};

const createOriginalLogWriter = () => {
  const stdoutWrite = process.stdout.write.bind(process.stdout);
  const stderrWrite = process.stderr.write.bind(process.stderr);

  return ({
    content,
    type,
  }: {
    content: string;
    type: 'stderr' | 'stdout';
  }) => {
    if (type === 'stderr') {
      stderrWrite(content);
      return;
    }

    stdoutWrite(content);
  };
};

const preparePool = async (
  {
    entryInfo: { distPath, testPath },
    updateSnapshot,
    context,
  }: RunWorkerOptions['options'],
  tracker?: PhaseTracker,
) => {
  // Reset globalCleanups only when preparePool is called again (running without isolation)
  globalCleanups.forEach((fn) => {
    fn();
  });
  globalCleanups.length = 0;

  const taskContext = createNodeTaskContext();
  setRealTimers();

  const cleanupFns: (() => MaybePromise<void>)[] = [];

  const disposeFns: (() => void)[] = [];
  const { rpc } = createRuntimeRpc(
    createWorkerRpcOptions({ dispose: disposeFns }),
  );

  globalCleanups.push(() => {
    disposeFns.forEach((fn) => {
      fn();
    });
    rpc.$close();
  });

  const {
    runtimeConfig: {
      globals,
      printConsoleTrace,
      disableConsoleIntercept,
      silent,
      testEnvironment,
      snapshotFormat,
      env,
    },
  } = context;

  setupEnv(env);

  const shouldInterceptConsole =
    !disableConsoleIntercept || silent === true || silent === 'passed-only';

  const silentConsoleController = createSilentConsoleController({
    runtimeConfig: {
      disableConsoleIntercept,
      silent,
    },
    emitInterceptedLog: (log) => {
      // Forwarding console output to the host is best-effort, fire-and-forget:
      // the result is never awaited. With `isolate: false` a captured console
      // (e.g. a logger that flushes from a late `setTimeout`/microtask) can fire
      // after this file's birpc channel has been closed or disposed by the host,
      // so the call rejects — immediately once the channel is `$close()`d, or
      // later when `$close()` rejects the still-pending request. Swallowing it
      // drops such an orphan log instead of surfacing an `unhandledRejection`
      // that fails the run and is misattributed to whichever file is currently
      // running. A dropped late log also stays subject to the host's
      // `onConsoleLog` policy, matching `isolate: true` where late logs are lost
      // as the worker is torn down.
      // See https://github.com/web-infra-dev/rstest/issues/1367.
      void rpc.onConsoleLog(log).catch(() => {});
    },
    writeOriginalLog: createOriginalLogWriter(),
  });

  if (shouldInterceptConsole) {
    const { createCustomConsole } = await import('./console');

    // Keep a minimal internal interception path when `silent` is enabled.
    // In `disableConsoleIntercept + silent` mode, logs are buffered in the
    // worker first and later replayed to the original worker streams according
    // to the silent policy, instead of being reported to the host.

    global.console = createCustomConsole({
      onConsoleLog: (log) => {
        silentConsoleController.onConsoleLog(log);
      },
      testPath,
      printConsoleTrace: !disableConsoleIntercept && printConsoleTrace,
      getCurrentTask: () => taskContext.getCurrent(),
    });
  }

  const interopDefault = true;

  const workerState: WorkerState = {
    ...context,
    snapshotOptions: {
      updateSnapshot,
      snapshotEnvironment: new RstestSnapshotEnvironment({
        resolveSnapshotPath: (filepath: string) =>
          rpc.resolveSnapshotPath(filepath),
      }),
      snapshotFormat,
    },
    distPath,
    testPath,
    environment: 'node',
  };

  const { createRstestRuntime, resetRstestTimersForFile } =
    await import('../api');

  const unhandledErrors: Error[] = [];

  const handleError = (e: unknown, type: string) => {
    const formattedError = formatError(e);
    const rawError =
      typeof formattedError === 'string'
        ? new Error(formattedError)
        : formattedError;
    const error =
      !rawError.name || rawError.name === 'Error'
        ? setErrorName(rawError, type)
        : rawError;

    if (isTeardown) {
      error.stack = `${color.yellow('Caught error after test environment was torn down:')}\n\n${error.stack}`;
      console.error(error);
    } else {
      console.error(error);
      unhandledErrors.push(error);
    }
  };

  const uncaughtException = (e: unknown) => handleError(e, 'uncaughtException');
  const unhandledRejection = (e: unknown) =>
    handleError(e, 'unhandledRejection');

  process.on('uncaughtException', uncaughtException);
  process.on('unhandledRejection', unhandledRejection);

  globalCleanups.push(() => {
    process.off('uncaughtException', uncaughtException);
    process.off('unhandledRejection', unhandledRejection);
  });

  const { api, runner } = await createRstestRuntime(workerState, {
    taskContext,
  });

  tracker?.transition('envSetup');
  // `node` is the no-op fast path; every other environment is resolved through
  // the registry so adding one is a single entry instead of a new switch arm.
  // teardown is `MaybePromise<void>` and is awaited via `Promise.all` in
  // `cleanup`, so a single uniform wrapper preserves both the sync (jsdom) and
  // async (happy-dom) teardown shapes.
  if (testEnvironment.name !== 'node') {
    const loadEnvironment = environmentLoaders[testEnvironment.name];
    if (!loadEnvironment) {
      throw new Error(`Unknown test environment: ${testEnvironment.name}`);
    }
    const { environment } = await loadEnvironment();
    const { teardown } = await environment.setup(
      global,
      testEnvironment.options || {},
    );
    cleanupFns.push(() => teardown(global));
  }
  tracker?.transition('prepare');

  if (globals) {
    registerGlobalApi(api);
  }

  const rstestContext = {
    global,
    console: global.console,
    Error,
  };

  // @ts-expect-error
  rstestContext.global[RSTEST_API_GLOBAL_KEY] = api;

  return {
    interopDefault,
    rstestContext,
    runner,
    rpc,
    silentConsoleController,
    api,
    taskContext,
    unhandledErrors,
    resetTimersForFile: resetRstestTimersForFile,
    cleanup: async () => {
      await resetRstestTimersForFile();
      await Promise.all(cleanupFns.map((fn) => fn()));
    },
  };
};

const loadFiles = async ({
  setupEntries,
  assetFiles,
  rstestContext,
  distPath,
  runtimeDistPath,
  testPath,
  interopDefault,
  isolate,
  outputModule,
  tracker,
}: {
  setupEntries: RunWorkerOptions['options']['setupEntries'];
  assetFiles: Record<string, string>;
  rstestContext: Record<string, any>;
  distPath: string;
  runtimeDistPath?: string;
  testPath: string;
  interopDefault: boolean;
  isolate: boolean;
  outputModule: boolean;
  tracker?: PhaseTracker;
}): Promise<void> => {
  const { loadModule } = outputModule
    ? await import('./loadEsModule')
    : await import('./loadModule');

  // Clean each kept runtime chunk's webpack module cache before re-running setup
  // + entry. A reused worker can hold several projects' runtime chunks at once
  // (isolate: false), so invoke EVERY registered cleaner — each is self-scoped to
  // its own chunk's cache, so over-calling is a harmless no-op. See
  // `moduleCacheControl.ts` for why this is a per-chunk registry, not a single
  // `global.__rstest_clean_core_cache__` slot.
  if (!isolate) {
    await loadModule({
      codeContent: `if (global && global.__rstest_cache_cleaners__) {
  global.__rstest_cache_cleaners__.forEach((fn) => fn());
  }`,
      distPath: '',
      testPath,
      rstestContext,
      assetFiles,
      interopDefault,
    });
  }

  // run setup files
  tracker?.transition('setupFiles');
  for (const { distPath, testPath } of setupEntries) {
    const setupCodeContent = assetFiles[distPath]!;

    await loadModule({
      codeContent: setupCodeContent,
      distPath,
      runtimeDistPath,
      testPath,
      rstestContext,
      assetFiles,
      interopDefault,
    });
  }

  tracker?.transition('collect');
  await loadModule({
    codeContent: assetFiles[distPath]!,
    distPath,
    runtimeDistPath,
    testPath,
    rstestContext,
    assetFiles,
    interopDefault,
  });
};

export const runInPool = async (
  options: RunWorkerOptions['options'],
): Promise<
  | {
      tests: TestInfo[];
      testPath: string;
    }
  | TestFileResult
> => {
  isTeardown = false;
  const {
    entryInfo: { distPath, runtimeDistPath, testPath },
    setupEntries,
    assets,
    type,
    context: {
      project,
      buildId,
      runtimeConfig: { isolate, bail, detectAsyncLeaks },
    },
  } = options;

  const importLoader = () =>
    options.context.outputModule
      ? import('./loadEsModule')
      : import('./loadModule');

  // Keeping the runtime chunk is correct within one compile, but a watch rebuild
  // (bumped `buildId`) would serve a changed shared module from the previous
  // build's cache. Fully flush every loader on the rebuild boundary before
  // loading (see `flushAllLoaderCaches` for why both loaders, not just this
  // task's).
  if (!isolate && lastBuildId !== undefined && lastBuildId !== buildId) {
    const { flushAllLoaderCaches } = await import('./interop');
    await flushAllLoaderCaches();
  }
  lastBuildId = buildId;

  const cleanups: (() => MaybePromise<void>)[] = [];

  const exit = process.exit.bind(process);
  process.exit = (code = process.exitCode || 0): never => {
    throw new Error(`process.exit unexpectedly called with "${code}"`);
  };

  const kill = process.kill.bind(process);
  process.kill = (pid: number, signal?: NodeJS.Signals) => {
    if (pid === -1 || Math.abs(pid) === process.pid) {
      throw new Error(
        `process.kill unexpectedly called with "${pid}" and "${signal}"`,
      );
    }
    return kill(pid, signal);
  };

  cleanups.push(() => {
    process.kill = kill;
    process.exit = exit;
  });

  const teardown = async () => {
    await new Promise((resolve) => getRealTimers().setTimeout!(resolve));

    // Run teardown
    await Promise.all(cleanups.map((fn) => fn()));

    if (!isolate) {
      const { clearModuleCache } = await importLoader();
      // Keep the shared runtime chunk so imported module state survives across
      // files; test-entry and setup modules are still evicted (see clearModuleCache).
      clearModuleCache(runtimeDistPath);
    }

    isTeardown = true;
  };

  // Initialize coverage collector if coverage is enabled
  let coverageProvider: Awaited<
    ReturnType<typeof import('../../coverage').createCoverageProvider>
  > | null = null;

  if (type === 'collect') {
    try {
      const {
        rstestContext,
        runner,
        rpc,
        cleanup,
        unhandledErrors,
        interopDefault,
      } = await preparePool(options);
      const { assetFiles, sourceMaps: sourceMapsFromAssets } =
        assets || (await rpc.getAssetsByEntry());
      sourceMaps = sourceMapsFromAssets;

      cleanups.push(cleanup);

      await loadFiles({
        rstestContext,
        distPath,
        runtimeDistPath,
        testPath,
        assetFiles,
        setupEntries,
        interopDefault,
        isolate,
        outputModule: options.context.outputModule,
      });
      const tests = await runner.collectTests();
      return {
        project,
        testPath,
        tests,
        errors: await formatTestError(unhandledErrors),
      };
    } catch (err) {
      return {
        project,
        testPath,
        tests: [],
        errors: await formatTestError(err),
      };
    } finally {
      await teardown();
    }
  }

  let taskContext: TaskContext | undefined;
  const tracker = new PhaseTracker(
    options.context.trace
      ? {
          trace: {
            testPath,
            project: options.context.project,
          },
          pid: tracePid,
        }
      : undefined,
  );
  let runResult: TestFileResult | undefined;
  let asyncLeakDetector: ReturnType<typeof createAsyncLeakDetector> | undefined;

  try {
    tracker.transition('prepare');
    const {
      rstestContext,
      runner,
      rpc,
      silentConsoleController,
      api,
      resetTimersForFile,
      cleanup,
      unhandledErrors,
      interopDefault,
      taskContext: preparedTaskContext,
    } = await preparePool(options, tracker);
    taskContext = preparedTaskContext;
    if (detectAsyncLeaks) {
      asyncLeakDetector = createAsyncLeakDetector(taskContext);
      asyncLeakDetector.enable();
    }

    if (bail && (await rpc.getCountOfFailedTests()) >= bail) {
      runResult = {
        testId: getFileTaskId(testPath),
        project,
        testPath,
        status: 'skip',
        name: '',
        results: [],
      };
      return runResult;
    }

    if (options.context.runtimeConfig.coverage?.enabled) {
      const { createCoverageProvider } = await import('../../coverage');
      coverageProvider = await createCoverageProvider(
        options.context.runtimeConfig.coverage,
        options.context.projectRoot,
      );
    }
    if (coverageProvider) {
      await coverageProvider.init();
    }

    tracker.transition('load');
    const { assetFiles, sourceMaps: sourceMapsFromAssets } =
      assets || (await rpc.getAssetsByEntry());
    sourceMaps = sourceMapsFromAssets;

    cleanups.push(cleanup);

    rpc.onTestFileStart?.({
      testId: getFileTaskId(testPath),
      testPath,
      tests: [],
    });

    // Keep file-level context only while evaluating top-level module code.
    // Once the runner starts, suite/case tasks should own subsequent logs so
    // passed suite buffers are not replayed by the final file-level flush.
    taskContext.setFallback({
      taskId: getFileTaskId(testPath),
      taskType: 'file',
      testPath,
    });

    try {
      await loadFiles({
        rstestContext,
        distPath,
        runtimeDistPath,
        testPath,
        assetFiles,
        setupEntries,
        interopDefault,
        isolate,
        outputModule: options.context.outputModule,
        tracker,
      });
    } finally {
      taskContext.setFallback(undefined);
    }

    tracker.transition('tests');
    const results = await runner.runTests(
      testPath,
      {
        onTestFileReady: async (test) => {
          await rpc.onTestFileReady(test);
        },
        onTestSuiteStart: async (test) => {
          tracker.recordSuiteStart(test);
          await rpc.onTestSuiteStart(test);
        },
        onTestSuiteResult: async (result) => {
          tracker.recordSuiteResult(result);
          silentConsoleController.flushBufferedLogsForTask({
            taskId: result.testId,
            status: result.status,
            taskParentNames: result.parentNames,
            taskType: 'suite',
            testPath: result.testPath,
          });
          await rpc.onTestSuiteResult(result);
        },
        onTestCaseStart: async (test) => {
          tracker.recordCaseStart(test);
          await rpc.onTestCaseStart(test);
        },
        onTestCaseResult: async (result) => {
          tracker.recordCaseResult(result);
          silentConsoleController.flushBufferedLogsForTask({
            taskId: result.testId,
            status: result.status,
            taskParentNames: result.parentNames,
            taskType: 'case',
            testPath: result.testPath,
          });
          await rpc.onTestCaseResult(result);
        },
        getCountOfFailedTests: async () => {
          return rpc.getCountOfFailedTests();
        },
      },
      api,
    );

    if (asyncLeakDetector) {
      // Undo any time mocking before collecting leaks and before a reused worker
      // runs the next file. The internal reset covers both full fake timers and
      // a date-only `setSystemTime()` pin, but does not initialize fake timers
      // for files that never used them.
      await resetTimersForFile();
      const asyncLeakErrors = await asyncLeakDetector.collectErrors();
      if (asyncLeakErrors.length > 0) {
        results.status = 'fail';
        results.errors = (results.errors || []).concat(asyncLeakErrors);
      }
    }

    if (unhandledErrors.length > 0) {
      results.status = 'fail';
      results.errors = (results.errors || []).concat(
        ...(await formatTestError(unhandledErrors)),
      );
    }

    silentConsoleController.flushBufferedLogsForTask({
      taskId: results.testId,
      status: results.status,
      taskParentNames: results.parentNames,
      taskType: 'file',
      testPath: results.testPath,
    });

    // Collect coverage data after test file completes
    if (coverageProvider) {
      const provider = coverageProvider;
      tracker.transition('coverage');
      const collectOptions = {
        assetFiles,
        sourceMaps,
        outputModule: options.context.outputModule,
      };

      const collectCoverage = async () => {
        const coverageMap = await provider.collect(collectOptions);
        if (coverageMap) {
          results.coverage = {};
          Object.entries(coverageMap.toJSON()).forEach(([key, value]) => {
            if ('toJSON' in value)
              results.coverage![key] = value.toJSON() as FileCoverageData;
            else results.coverage![key] = value;
          });
        }
      };

      if (provider.collectRaw && provider.resolveRawCoverage) {
        const rawCoverage = await provider.collectRaw(collectOptions);
        if (rawCoverage != null) {
          results.coverageRaw = rawCoverage;
        } else {
          await collectCoverage();
        }
      } else {
        await collectCoverage();
      }
    }

    runResult = results;
    return runResult;
  } catch (err) {
    runResult = {
      testId: getFileTaskId(testPath),
      project,
      testPath,
      status: 'fail',
      name: '',
      results: [],
      errors: await formatTestError(err),
    };
    return runResult;
  } finally {
    tracker.transition('teardown');
    if (coverageProvider) {
      coverageProvider.cleanup();
    }

    taskContext?.setFallback(undefined);
    asyncLeakDetector?.disable();
    await teardown();
    tracker.end();
    if (runResult) {
      const traceEvents = tracker.getTraceEvents();
      if (traceEvents) {
        runResult.traceEvents = traceEvents;
      }
    }
  }
};
