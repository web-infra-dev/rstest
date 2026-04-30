import type { PoolWorker } from '../poolWorker';
import type { PoolOptions, PoolTask } from '../types';
import { ForksPoolWorker } from './forksPoolWorker';

export function createPoolWorker(
  task: PoolTask,
  options: PoolOptions,
  workerId: number,
): PoolWorker {
  switch (task.worker) {
    case 'forks': {
      return new ForksPoolWorker({
        name: `forks-${workerId}`,
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
