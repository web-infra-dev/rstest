import type {
  MaybePromise,
  Rstest,
  RunWorkerOptions,
  Test,
  TestFileResult,
  WorkerState,
} from '../../types';
import './setup';
import { setTimeout } from 'node:timers';
import { globalApis } from '../../utils/constants';
import { color, undoSerializableConfig } from '../../utils/helper';
import { formatTestError } from '../util';
import { loadModule } from './loadModule';
import { createForksRpcOptions, createRuntimeRpc } from './rpc';
import { RstestSnapshotEnvironment } from './snapshot';

const getGlobalApi = (api: Rstest) => {
  return globalApis.reduce<{
    [key in keyof Rstest]?: Rstest[key];
  }>((apis, key) => {
    apis[key] = api[key] as any;
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
  listeners.forEach((fn) => fn());
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

  if (testEnvironment === 'jsdom') {
    const { environment } = await import('./env/jsdom');
    const { teardown } = await environment.setup(global, {});
    cleanupFns.push(() => teardown(global));
  } else if (testEnvironment === 'happy-dom') {
    const { environment } = await import('./env/happyDom');
    const { teardown } = await environment.setup(global, {});
    cleanupFns.push(async () => await teardown(global));
  }

  const rstestContext = {
    global,
    console: global.console,
    Error,
    ...(globals ? getGlobalApi(api) : {}),
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
      runtimeConfig: { isolate },
    },
  } = options;

  const cleanups: (() => MaybePromise<void>)[] = [];

  const exit = process.exit;
  process.exit = (code = process.exitCode || 0): never => {
    throw new Error(`process.exit unexpectedly called with "${code}"`);
  };

  cleanups.push(() => {
    process.exit = exit;
  });

  process.off('SIGTERM', onExit);

  const teardown = async () => {
    await new Promise((resolve) => setTimeout(resolve));

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
        testPath,
        tests,
        errors: formatTestError(unhandledErrors),
      };
    } catch (err) {
      return {
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
