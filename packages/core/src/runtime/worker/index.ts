import type {
  MaybePromise,
  Rstest,
  RunWorkerOptions,
  Test,
  TestFileResult,
  WorkerState,
} from '../../types';
import './setup';
import { createCoverageProvider } from '../../coverage';
import { globalApis } from '../../utils/constants';
import { color, undoSerializableConfig } from '../../utils/helper';
import { formatTestError, getRealTimers, setRealTimers } from '../util';
import { loadModule } from './loadModule';
import { createForksRpcOptions, createRuntimeRpc } from './rpc';
import { RstestSnapshotEnvironment } from './snapshot';

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

const preparePool = async ({
  entryInfo: { distPath, testPath },
  sourceMaps,
  updateSnapshot,
  context,
}: RunWorkerOptions['options']) => {
  setRealTimers();
  context.runtimeConfig = undoSerializableConfig(context.runtimeConfig);

  const cleanupFns: (() => MaybePromise<void>)[] = [];

  const { rpc } = createRuntimeRpc(createForksRpcOptions());
  const {
    runtimeConfig: {
      globals,
      printConsoleTrace,
      disableConsoleIntercept,
      testEnvironment,
    },
  } = context;

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
      snapshotEnvironment: new RstestSnapshotEnvironment(),
    },
    distPath,
    testPath,
    environment: 'node',
  };

  const { createRstestRuntime } = await import('../api');
  // provides source map support for stack traces
  const { install } = await import('source-map-support');

  install({
    // @ts-expect-error map type
    retrieveSourceMap: (source) => {
      if (sourceMaps[source]) {
        return {
          url: source,
          map: sourceMaps[source],
        };
      }
      return null;
    },
  });

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

  const { api, runner } = createRstestRuntime(workerState);

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
}: {
  setupEntries: RunWorkerOptions['options']['setupEntries'];
  assetFiles: RunWorkerOptions['options']['assetFiles'];
  rstestContext: Record<string, any>;
  distPath: string;
  testPath: string;
  interopDefault: boolean;
  isolate: boolean;
}): Promise<void> => {
  // clean rstest core cache manually
  if (!isolate) {
    await loadModule({
      codeContent: `if (global && typeof global.__rstest_clean_core_cache__ === 'function') {
  global.__rstest_clean_core_cache__();
  }`,
      distPath,
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

const onExit = () => {
  process.exit();
};

const runInPool = async (
  options: RunWorkerOptions['options'],
): Promise<
  | {
      tests: Test[];
      testPath: string;
    }
  | TestFileResult
> => {
  isTeardown = false;
  const {
    entryInfo: { distPath, testPath },
    setupEntries,
    assetFiles,
    type,
    context: {
      project,
      runtimeConfig: { isolate },
    },
  } = options;

  const cleanups: (() => MaybePromise<void>)[] = [];

  const exit = process.exit.bind(process);
  process.exit = (code = process.exitCode || 0): never => {
    throw new Error(`process.exit unexpectedly called with "${code}"`);
  };

  cleanups.push(() => {
    process.exit = exit;
  });

  process.off('SIGTERM', onExit);

  const teardown = async () => {
    await new Promise((resolve) => getRealTimers().setTimeout!(resolve));

    await Promise.all(cleanups.map((fn) => fn()));
    isTeardown = true;
    // should exit correctly when user's signal listener exists
    process.once('SIGTERM', onExit);
  };

  if (type === 'collect') {
    try {
      const {
        rstestContext,
        runner,
        cleanup,
        unhandledErrors,
        interopDefault,
      } = await preparePool(options);

      cleanups.push(cleanup);

      await loadFiles({
        rstestContext,
        distPath,
        testPath,
        assetFiles,
        setupEntries,
        interopDefault,
        isolate,
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
    // Initialize coverage collector if coverage is enabled
    const coverageProvider = await createCoverageProvider(
      options.context.runtimeConfig.coverage || {},
      options.context.rootPath,
    );
    if (coverageProvider) {
      coverageProvider.init();
    }

    cleanups.push(cleanup);

    await loadFiles({
      rstestContext,
      distPath,
      testPath,
      assetFiles,
      setupEntries,
      interopDefault,
      isolate,
    });
    const results = await runner.runTests(
      testPath,
      {
        onTestFileStart: async (test) => {
          await rpc.onTestFileStart(test);
        },
        onTestFileResult: async (test) => {
          // Collect coverage data after test file completes
          if (coverageProvider) {
            const coverageMap = coverageProvider.collect();
            if (coverageMap) {
              // Attach coverage data to test result
              (test as any).coverage = coverageMap.toJSON();
            }
          }
          await rpc.onTestFileResult(test);
        },
        onTestCaseResult: async (result) => {
          await rpc.onTestCaseResult(result);
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

    return results;
  } catch (err) {
    return {
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
