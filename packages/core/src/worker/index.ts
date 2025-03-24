import { globalApis } from '../constants';
import type {
  Rstest,
  RunWorkerOptions,
  TestResult,
  WorkerState,
} from '../types';
import { logger } from '../utils/logger';
import { loadModule } from './loadModule';

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
  assetFiles,
  context,
}: RunWorkerOptions['options']): Promise<TestResult> => {
  // const { rpc } = createRuntimeRpc(createForksRpcOptions());
  const codeContent = assetFiles[filePath]!;
  const {
    normalizedConfig: { globals },
    rootPath,
  } = context;

  const workerState: WorkerState = {
    filePath,
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
    loadModule({
      codeContent,
      distPath: filePath,
      originPath,
      rstestContext,
      assetFiles,
    });

    const results = await runner.runTest(originPath, rootPath);

    return results;
  } catch (err) {
    logger.error(
      `run file ${originPath} failed:\n`,
      err instanceof Error ? err.message : err,
    );
    return {
      status: 'fail',
      name: originPath,
      results: [],
    };
  }
};

export default runInPool;
