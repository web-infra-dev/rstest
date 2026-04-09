import type { PoolOptions, PoolTask } from '../types';
import type { PoolWorker } from '../poolWorker';
import { ForksPoolWorker } from './forksPoolWorker';

let nextWorkerSeq = 0;

export function createPoolWorker(
  task: PoolTask,
  options: PoolOptions,
): PoolWorker {
  switch (task.worker) {
    case 'forks': {
      const seq = ++nextWorkerSeq;
      return new ForksPoolWorker({
        name: `forks-${seq}`,
        filename: options.workerEntry,
        env: options.env,
        execArgv: options.execArgv,
      });
    }
    default: {
      const _exhaustive: never = task.worker;
      throw new Error(`Unknown pool worker: ${String(_exhaustive)}`);
    }
  }
}
