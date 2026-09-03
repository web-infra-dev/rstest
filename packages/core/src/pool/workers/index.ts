import type { PoolWorker } from '../poolWorker';
import type { PoolOptions, PoolTask } from '../types';
import { ForksPoolWorker } from './forksPoolWorker';
import { ThreadsPoolWorker } from './threadsPoolWorker';

export const composeSpawnEnv = (task: PoolTask): Record<string, string> => {
  const env: Record<string, string> = { NODE_ENV: 'test' };

  for (const [key, value] of Object.entries(
    task.options.context.runtimeConfig.env,
  )) {
    if (value !== undefined) {
      env[key] = value;
    }
  }

  return env;
};

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
        env: composeSpawnEnv(task),
        execArgv: options.execArgv,
        forwardStdio: options.forwardStdio,
      });
    }
    case 'threads': {
      return new ThreadsPoolWorker({
        name: `threads-${workerId}`,
        filename: options.workerEntry,
        env: composeSpawnEnv(task),
        execArgv: options.execArgv,
        forwardStdio: options.forwardStdio,
      });
    }
    default: {
      const _exhaustive: never = task.worker;
      throw new Error(`Unknown pool worker: ${String(_exhaustive)}`);
    }
  }
}
