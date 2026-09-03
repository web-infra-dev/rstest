import { omitColorEnv, pickColorEnv } from '../../utils/logger';
import type { PoolWorker } from '../poolWorker';
import type { PoolOptions, PoolTask } from '../types';
import { ForksPoolWorker } from './forksPoolWorker';
import { ThreadsPoolWorker } from './threadsPoolWorker';

/**
 * Spawn with the host env plus the creating task's resolved color env. Other
 * project env stays task-scoped and is applied by `setupEnv` after startup so
 * bootstrap-sensitive variables are not interpreted by Node.
 */
export const composeSpawnEnv = (task: PoolTask): Record<string, string> => {
  const spawnEnv = {
    ...omitColorEnv({ NODE_ENV: 'test', ...process.env }),
    ...pickColorEnv(task.options.context.runtimeConfig.env),
  };
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(spawnEnv)) {
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
