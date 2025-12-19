import EventEmitter from 'node:events';
import { fileURLToPath } from 'node:url';
import { createBirpc } from 'birpc';
import { dirname, resolve } from 'pathe';
import { type Options, Tinypool } from 'tinypool';
import type {
  FormattedError,
  RuntimeRPC,
  RunWorkerOptions,
  ServerRPC,
  Test,
  TestFileResult,
} from '../types';
import { createWorkerStderrCapture } from './stderrCapture';
import { parseWorkerMetaMessage, type WorkerMetaMessage } from './workerMeta';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export type ForksChannel = {
  onMessage: (callback: (...args: any[]) => void) => void;
  postMessage: (message: any) => void;
};

export type ForksChannelContext = {
  channel: ForksChannel;
  cleanup: () => void;
};

export function createForksChannel(
  rpcMethods: RuntimeRPC,
  onWorkerMeta?: (message: WorkerMetaMessage) => void,
  createBirpcImpl: typeof createBirpc = createBirpc,
): ForksChannelContext {
  const emitter = new EventEmitter();
  const events = { message: 'message', response: 'response' };
  const channel: ForksChannel = {
    onMessage: (callback: (...args: any[]) => void): void => {
      emitter.on(events.message, callback);
    },
    postMessage: (message: any): void => {
      const workerMeta = parseWorkerMetaMessage(message);
      if (workerMeta) {
        onWorkerMeta?.(workerMeta);
        return;
      }
      emitter.emit(events.response, message);
    },
  };

  const rpc = createBirpcImpl<ServerRPC, RuntimeRPC>(rpcMethods, {
    timeout: -1,
    post(v) {
      emitter.emit(events.message, v);
    },
    on(fn) {
      emitter.on(events.response, fn);
    },
  });

  const cleanup = (): void => {
    rpc.$close(new Error('[rstest-pool]: Pending methods while closing rpc'));
    emitter.removeAllListeners();
  };

  return { channel: channel, cleanup: cleanup };
}

export const createForksPool = (poolOptions: {
  env?: Record<string, string>;
  maxWorkers?: number;
  minWorkers?: number;
  execArgv?: string[];
  isolate?: boolean;
}): {
  name: string;
  runTest: (options: RunWorkerOptions) => Promise<TestFileResult>;
  collectTests: (options: RunWorkerOptions) => Promise<{
    tests: Test[];
    testPath: string;
    project: string;
    errors?: FormattedError[];
  }>;
  close: () => Promise<void>;
} => {
  const {
    maxWorkers: maxThreads,
    minWorkers: minThreads,
    env,
    execArgv = [],
    isolate = true,
  } = poolOptions;

  const options: Options = {
    runtime: 'child_process',
    filename: resolve(__dirname, './worker.js'),
    env,
    execArgv,
    maxThreads,
    minThreads,
    concurrentTasksPerWorker: 1,
    isolateWorkers: isolate,
    serialization: 'advanced',
  };

  const pool = new Tinypool(options);
  const stderrCapture = createWorkerStderrCapture(pool);
  let nextTaskId = 0;

  return {
    name: 'forks',
    runTest: async ({ options, rpcMethods }: RunWorkerOptions) => {
      const taskId = ++nextTaskId;
      stderrCapture.createTask(taskId);
      const { channel, cleanup } = createForksChannel(rpcMethods, ({ pid }) => {
        stderrCapture.bindTaskToPid(taskId, pid);
      });
      try {
        return await pool.run(options, { channel });
      } catch (err) {
        await stderrCapture.enhanceWorkerExitError(taskId, err);
        throw err;
      } finally {
        cleanup();
        stderrCapture.clearTask(taskId);
      }
    },
    collectTests: async ({ options, rpcMethods }: RunWorkerOptions) => {
      const taskId = ++nextTaskId;
      stderrCapture.createTask(taskId);
      const { channel, cleanup } = createForksChannel(rpcMethods, ({ pid }) => {
        stderrCapture.bindTaskToPid(taskId, pid);
      });
      try {
        return await pool.run(options, { channel });
      } catch (err) {
        await stderrCapture.enhanceWorkerExitError(taskId, err);
        throw err;
      } finally {
        cleanup();
        stderrCapture.clearTask(taskId);
      }
    },
    close: async () => {
      stderrCapture.cleanup();
      await pool.destroy();
    },
  };
};
