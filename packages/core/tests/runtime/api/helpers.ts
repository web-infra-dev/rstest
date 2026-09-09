import { createRstestUtilities } from '../../../src/runtime/api/utilities';
import {
  type FileContext,
  setFileContext,
} from '../../../src/runtime/fileContext';
import type { WorkerState } from '../../../src/types';

export function createWorkerState(): WorkerState {
  return {
    runtimeConfig: {
      testTimeout: 1_000,
      hookTimeout: 1_000,
      clearMocks: false,
      resetMocks: false,
      restoreMocks: false,
      maxConcurrency: 5,
      retry: 0,
    },
  } as WorkerState;
}

/**
 * `createRstestUtilities` resolves the running file's worker state through the
 * file context at call time; publish a fresh one per construction, as
 * `createRunner` does in production.
 */
export const createUtilities = async () => {
  setFileContext({ workerState: createWorkerState() } as FileContext);
  return createRstestUtilities();
};
