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
import { globalApis } from '../../utils/constants';
import { color } from '../../utils/logger';
import { formatTestError, getRealTimers, setRealTimers } from '../util';
import { createAsyncLeakDetector } from './asyncLeaks';
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

const getFileTaskId = (testPath: string): string => {
  return `file:${testPath}`;
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
    emitInterceptedLog: async (log) => {
      await rpc.onConsoleLog(log);
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

  const { createRstestRuntime } = await import('../api');

  const unhandledErrors: Error[] = [];

  const handleError = (e: Error | string, type: string) => {
    const rawError: Error = typeof e === 'string' ? new Error(e) : e;
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

  const uncaughtException = (e: Error) => handleError(e, 'uncaughtException');
  const unhandledRejection = (e: Error) => handleError(e, 'unhandledRejection');

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
  switch (testEnvironment.name) {
    case 'node':
      break;
    case 'jsdom': {
      const { environment } = await import('./env/jsdom');
      const { teardown } = await environment.setup(
        global,
        testEnvironment.options || {},
      );
      cleanupFns.push(() => teardown(global));
      break;
    }
    case 'happy-dom': {
      const { environment } = await import('./env/happyDom');
      const { teardown } = await environment.setup(
        global,
        testEnvironment.options || {},
      );
      cleanupFns.push(async () => teardown(global));
      break;
    }
    default:
      throw new Error(`Unknown test environment: ${testEnvironment.name}`);
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
  rstestContext.global['@rstest/core'] = api;

  return {
    interopDefault,
    rstestContext,
    runner,
    rpc,
    silentConsoleController,
    api,
    taskContext,
    unhandledErrors,
    cleanup: async () => {
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

  // clean rstest core cache manually
  if (!isolate) {
    await loadModule({
      codeContent: `if (global && typeof global.__rstest_clean_core_cache__ === 'function') {
  global.__rstest_clean_core_cache__();
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
      runtimeConfig: { isolate, bail, detectAsyncLeaks },
    },
  } = options;

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
      const { clearModuleCache } = options.context.outputModule
        ? await import('./loadEsModule')
        : await import('./loadModule');
      clearModuleCache();
    }

    isTeardown = true;
  };

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
    // Initialize coverage collector if coverage is enabled
    let coverageProvider: Awaited<
      ReturnType<typeof import('../../coverage').createCoverageProvider>
    > | null = null;
    if (options.context.runtimeConfig.coverage?.enabled) {
      const { createCoverageProvider } = await import('../../coverage');
      coverageProvider = await createCoverageProvider(
        options.context.runtimeConfig.coverage,
        options.context.rootPath,
      );
    }
    if (coverageProvider) {
      coverageProvider.init();
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
      tracker.transition('coverage');
      const coverageMap = coverageProvider.collect();
      if (coverageMap) {
        // Attach coverage data to test result
        results.coverage = {};
        Object.entries(coverageMap.toJSON()).forEach(([key, value]) => {
          if ('toJSON' in value)
            results.coverage![key] = value.toJSON() as FileCoverageData;
          else results.coverage![key] = value;
        });
      }
      // Cleanup
      coverageProvider.cleanup();
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
