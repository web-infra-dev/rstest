import { runner } from '../runner';
import type { RunWorkerOptions, TestResult } from '../types';
import { logger } from '../utils/logger';
import { loadModule } from './loadModule';
import { setWorkerState } from './state';

const runInPool = async ({
  entryInfo: { filePath, originPath },
  assetFiles,
}: RunWorkerOptions['options']): Promise<TestResult> => {
  // const { rpc } = createRuntimeRpc(createForksRpcOptions());
  const codeContent = assetFiles[filePath]!;

  setWorkerState({
    filePath,
    environment: 'node',
  });

  const RstestAPI = await import('../api');

  const rstestContext = {
    global: {
      '@rstest/core': RstestAPI,
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
