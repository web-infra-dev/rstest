import type {
  MaybePromise,
  Rstest,
  RunWorkerOptions,
  TestFileResult,
  TestInfo,
  WorkerState,
} from '../../types';
import './setup';
import type { FileCoverageData } from 'istanbul-lib-coverage';
import { install } from 'source-map-support';
import { createCoverageProvider } from '../../coverage';
import { globalApis } from '../../utils/constants';
import { color } from '../../utils/helper';
import { formatTestError, getRealTimers, setRealTimers } from '../util';
import { createForksRpcOptions, createRuntimeRpc } from './rpc';
import { RstestSnapshotEnvironment } from './snapshot';

let sourceMaps: Record<string, string> = {};

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

const listeners: (() => void)[] = [];
let isTeardown = false;

const setupEnv = (env?: Partial<NodeJS.ProcessEnv>) => {
  if (env) {
    Object.assign(process.env, env);
  }
};

const preparePool = async ({
  entryInfo: { distPath, testPath },
  updateSnapshot,
  context,
}: RunWorkerOptions['options']) => {
  setRealTimers();

  // Prefer public env var from tinypool, fallback to context.taskId
  process.env.RSTEST_WORKER_ID = String(
    process.__tinypool_state__.workerId || context.taskId,
  );

  const cleanupFns: (() => MaybePromise<void>)[] = [];

  const originalConsole = global.console;

  const { rpc } = createRuntimeRpc(createForksRpcOptions(), {
    originalConsole,
  });
  const {
    runtimeConfig: {
      globals,
      printConsoleTrace,
      disableConsoleIntercept,
      testEnvironment,
      snapshotFormat,
      env,
    },
  } = context;

  setupEnv(env);

  if (!disableConsoleIntercept) {
    const { createCustomConsole } = await import('./console');

    global.console = createCustomConsole({
      rpc,
      testPath,
      printConsoleTrace,
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

  // Reset listeners only when preparePool is called again (running without isolation)
  listeners.forEach((fn) => {
    fn();
  });
  listeners.length = 0;

  const unhandledErrors: Error[] = [];

  const handleError = (e: Error | string, type: string) => {
    const error: Error = typeof e === 'string' ? new Error(e) : e;

    error.name = type;

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

  listeners.push(() => {
    process.off('uncaughtException', uncaughtException);
    process.off('unhandledRejection', unhandledRejection);
  });

  const { api, runner } = await createRstestRuntime(workerState);

  switch (testEnvironment) {
    case 'node':
      break;
    case 'jsdom': {
      const { environment } = await import('./env/jsdom');
      const { teardown } = await environment.setup(global, {});
      cleanupFns.push(() => teardown(global));
      break;
    }
    case 'happy-dom': {
      const { environment } = await import('./env/happyDom');
      const { teardown } = await environment.setup(global, {});
      cleanupFns.push(async () => teardown(global));
      break;
    }
    default:
      throw new Error(`Unknown test environment: ${testEnvironment}`);
  }

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
    api,
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
  testPath,
  interopDefault,
  isolate,
  outputModule,
}: {
  setupEntries: RunWorkerOptions['options']['setupEntries'];
  assetFiles: Record<string, string>;
  rstestContext: Record<string, any>;
  distPath: string;
  testPath: string;
  interopDefault: boolean;
  isolate: boolean;
  outputModule: boolean;
}): Promise<void> => {
  const { loadModule, updateLatestAssetFiles } = outputModule
    ? await import('./loadEsModule')
    : await import('./loadModule');

  // clean rstest core cache manually
  if (!isolate) {
    updateLatestAssetFiles(assetFiles);
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
  for (const { distPath, testPath } of setupEntries) {
    const setupCodeContent = assetFiles[distPath]!;

    await loadModule({
      codeContent: setupCodeContent,
      distPath,
      testPath,
      rstestContext,
      assetFiles,
      interopDefault,
    });
  }

  await loadModule({
    codeContent: assetFiles[distPath]!,
    distPath,
    testPath,
    rstestContext,
    assetFiles,
    interopDefault,
  });
};

const runInPool = async (
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
    entryInfo: { distPath, testPath },
    setupEntries,
    assets,
    type,
    context: {
      project,
      runtimeConfig: { isolate, bail },
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
        errors: formatTestError(unhandledErrors),
      };
    } catch (err) {
      return {
        project,
        testPath,
        tests: [],
        errors: formatTestError(err),
      };
    } finally {
      await teardown();
    }
  }

  try {
    const {
      rstestContext,
      runner,
      rpc,
      api,
      cleanup,
      unhandledErrors,
      interopDefault,
    } = await preparePool(options);

    if (bail && (await rpc.getCountOfFailedTests()) >= bail) {
      return {
        testId: '0',
        project,
        testPath,
        status: 'skip',
        name: '',
        results: [],
      };
    }
    // Initialize coverage collector if coverage is enabled
    const coverageProvider = await createCoverageProvider(
      options.context.runtimeConfig.coverage || {},
      options.context.rootPath,
    );
    if (coverageProvider) {
      coverageProvider.init();
    }

    const { assetFiles, sourceMaps: sourceMapsFromAssets } =
      assets || (await rpc.getAssetsByEntry());
    sourceMaps = sourceMapsFromAssets;

    cleanups.push(cleanup);

    rpc.onTestFileStart?.({ testPath, tests: [] });

    await loadFiles({
      rstestContext,
      distPath,
      testPath,
      assetFiles,
      setupEntries,
      interopDefault,
      isolate,
      outputModule: options.context.outputModule,
    });
    const results = await runner.runTests(
      testPath,
      {
        onTestFileReady: async (test) => {
          await rpc.onTestFileReady(test);
        },
        onTestSuiteStart: async (test) => {
          await rpc.onTestSuiteStart(test);
        },
        onTestSuiteResult: async (result) => {
          await rpc.onTestSuiteResult(result);
        },
        onTestCaseStart: async (test) => {
          await rpc.onTestCaseStart(test);
        },
        onTestCaseResult: async (result) => {
          await rpc.onTestCaseResult(result);
        },
        getCountOfFailedTests: async () => {
          return rpc.getCountOfFailedTests();
        },
      },
      api,
    );

    if (unhandledErrors.length > 0) {
      results.status = 'fail';
      results.errors = (results.errors || []).concat(
        ...formatTestError(unhandledErrors),
      );
    }

    // Collect coverage data after test file completes
    if (coverageProvider) {
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

    return results;
  } catch (err) {
    return {
      testId: '0',
      project,
      testPath,
      status: 'fail',
      name: '',
      results: [],
      errors: formatTestError(err),
    };
  } finally {
    await teardown();
  }
};

export default runInPool;
