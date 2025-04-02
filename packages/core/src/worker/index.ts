import { NodeSnapshotEnvironment } from '@vitest/snapshot/environment';
import { globalApis } from '../constants';
import type {
  Rstest,
  RunWorkerOptions,
  TestFileResult,
  WorkerState,
} from '../types';
import { logger } from '../utils';
import { loadModule } from './loadModule';
import { createForksRpcOptions, createRuntimeRpc } from './rpc';

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
  updateSnapshot,
  context,
}: RunWorkerOptions['options']): Promise<TestFileResult> => {
  const { rpc } = createRuntimeRpc(createForksRpcOptions());
  const codeContent = assetFiles[filePath]!;
  const {
    normalizedConfig: { globals },
  } = context;

  const workerState: WorkerState = {
    ...context,
    snapshotOptions: {
      updateSnapshot,
      snapshotEnvironment: new NodeSnapshotEnvironment(),
    },
    filePath,
    sourcePath: originPath,
    environment: 'node',
  };

  const { createRstestRuntime } = await import('../api');
  const { api, runner } = createRstestRuntime(workerState);

  const rstestContext = {
    global: {
      '@rstest/core': api,
    },
    ...(globals ? getGlobalApi(api) : {}),
  };

  try {
    // run setup files
    for (const { filePath, originPath } of setupEntries) {
      const setupCodeContent = assetFiles[filePath]!;

      loadModule({
        codeContent: setupCodeContent,
        distPath: filePath,
        originPath: originPath,
        rstestContext,
        assetFiles,
      });
    }

    loadModule({
      codeContent,
      distPath: filePath,
      originPath,
      rstestContext,
      assetFiles,
    });

    const results = await runner.runTest(originPath, {
      onTestFileStart: async (test) => {
        await rpc.onTestFileStart(test);
      },
      onTestCaseResult: async (result) => {
        await rpc.onTestCaseResult(result);
      },
    });

    return results;
  } catch (err) {
    logger.error(
      `run file ${originPath} failed:\n`,
      err instanceof Error ? err.message : err,
    );
    return {
      testPath: originPath,
      status: 'fail',
      name: originPath,
      results: [],
    };
  }
};

export default runInPool;
