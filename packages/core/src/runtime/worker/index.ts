import type {
  Rstest,
  RunWorkerOptions,
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

const runInPool = async ({
  entryInfo: { filePath, originPath },
  setupEntries,
  assetFiles,
  sourceMaps,
  updateSnapshot,
  context,
}: RunWorkerOptions['options']): Promise<TestFileResult> => {
  context.runtimeConfig = undoSerializableConfig(context.runtimeConfig);

  const { rpc } = createRuntimeRpc(createForksRpcOptions());
  const codeContent = assetFiles[filePath]!;
  const {
    runtimeConfig: { globals, printConsoleTrace, disableConsoleIntercept },
  } = context;

  const workerState: WorkerState = {
    ...context,
    snapshotOptions: {
      updateSnapshot,
      snapshotEnvironment: new RstestSnapshotEnvironment(),
    },
    filePath,
    sourcePath: originPath,
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
          testPath: originPath,
          printConsoleTrace,
        }),
    Error,
    ...(globals ? getGlobalApi(api) : {}),
  };

  try {
    // run setup files
    for (const { filePath, originPath } of setupEntries) {
      const setupCodeContent = assetFiles[filePath]!;

      await loadModule({
        codeContent: setupCodeContent,
        distPath: filePath,
        originPath: originPath,
        rstestContext,
        assetFiles,
      });
    }

    await loadModule({
      codeContent,
      distPath: filePath,
      originPath,
      rstestContext,
      assetFiles,
    });

    const results = await runner.runTest(
      originPath,
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
      testPath: originPath,
      status: 'fail',
      name: '',
      results: [],
      errors: formatTestError(err),
    };
  }
};

export default runInPool;
