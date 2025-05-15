import type {
  Rstest,
  RunWorkerOptions,
  Test,
  TestFileResult,
  WorkerState,
} from '../../types';
import { globalApis } from '../../utils/constants';
import { undoSerializableConfig } from '../../utils/helper';
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

const preparePool = async ({
  entryInfo: { distPath, testPath },
  sourceMaps,
  updateSnapshot,
  context,
}: RunWorkerOptions['options']) => {
  context.runtimeConfig = undoSerializableConfig(context.runtimeConfig);

  const { rpc } = createRuntimeRpc(createForksRpcOptions());
  const {
    runtimeConfig: { globals, printConsoleTrace, disableConsoleIntercept },
  } = context;

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

  const { createCustomConsole } = await import('./console');

  const { api, runner } = createRstestRuntime(workerState);

  const rstestContext = {
    global: {
      '@rstest/core': api,
    },
    console: disableConsoleIntercept
      ? console
      : createCustomConsole({
          rpc,
          testPath,
          printConsoleTrace,
        }),
    Error,
    ...(globals ? getGlobalApi(api) : {}),
  };

  return {
    rstestContext,
    runner,
    rpc,
    api,
  };
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
  const {
    entryInfo: { distPath, testPath },
    setupEntries,
    assetFiles,
    type,
  } = options;

  const { rstestContext, runner, rpc, api } = await preparePool(options);

  const loadFiles = async () => {
    // run setup files
    for (const { distPath, testPath } of setupEntries) {
      const setupCodeContent = assetFiles[distPath]!;

      await loadModule({
        codeContent: setupCodeContent,
        distPath,
        testPath,
        rstestContext,
        assetFiles,
      });
    }

    await loadModule({
      codeContent: assetFiles[distPath]!,
      distPath,
      testPath,
      rstestContext,
      assetFiles,
    });
  };

  if (type === 'collect') {
    try {
      await loadFiles();
      const tests = await runner.collectTests();
      return {
        testPath,
        tests,
      };
    } catch (err) {
      // TODO: log error
      return {
        testPath,
        tests: [],
      };
    }
  }

  try {
    await loadFiles();
    const results = await runner.runTests(
      testPath,
      {
        onTestFileStart: async (test) => {
          await rpc.onTestFileStart(test);
        },
        onTestCaseResult: async (result) => {
          await rpc.onTestCaseResult(result);
        },
      },
      api,
    );

    return results;
  } catch (err) {
    return {
      testPath,
      status: 'fail',
      name: '',
      results: [],
      errors: formatTestError(err),
    };
  }
};

export default runInPool;
