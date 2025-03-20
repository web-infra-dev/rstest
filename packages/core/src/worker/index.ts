import type { RunWorkerOptions, TestResult, WorkerState } from '../types';
import { logger } from '../utils/logger';
import { loadModule } from './loadModule';

const runInPool = async ({
  entryInfo: { filePath, originPath },
  assetFiles,
}: RunWorkerOptions['options']): Promise<TestResult> => {
  // const { rpc } = createRuntimeRpc(createForksRpcOptions());
  const codeContent = assetFiles[filePath]!;

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
  };

  try {
    loadModule({
      codeContent,
      distPath: filePath,
      originPath,
      rstestContext,
      assetFiles,
    });

    const results = await runner.run(originPath);

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
