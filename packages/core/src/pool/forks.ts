import EventEmitter from 'node:events';
import { fileURLToPath } from 'node:url';
import v8 from 'node:v8';
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

function createChannel(
  rpcMethods: RuntimeRPC,
  onWorkerMeta?: (message: WorkerMetaMessage) => void,
) {
  const emitter = new EventEmitter();
  const cleanup = () => emitter.removeAllListeners();

  const events = { message: 'message', response: 'response' };
  const channel = {
    onMessage: (callback: any) => {
      emitter.on(events.message, callback);
    },
    postMessage: (message: any) => {
      const workerMeta = parseWorkerMetaMessage(message);
      if (workerMeta) {
        onWorkerMeta?.(workerMeta);
        return;
      }
      emitter.emit(events.response, message);
    },
  };

  createBirpc<ServerRPC, RuntimeRPC>(rpcMethods, {
    serialize: v8.serialize,
    deserialize: (v) => v8.deserialize(Buffer.from(v)),
    post(v) {
      emitter.emit(events.message, v);
    },
    on(fn) {
      emitter.on(events.response, fn);
    },
  });

  return { channel, cleanup };
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
  };

  const pool = new Tinypool(options);
  const stderrCapture = createWorkerStderrCapture(pool);
  let nextTaskId = 0;

  return {
    name: 'forks',
    runTest: async ({ options, rpcMethods }: RunWorkerOptions) => {
      const taskId = ++nextTaskId;
      stderrCapture.createTask(taskId);
      const { channel, cleanup } = createChannel(rpcMethods, ({ pid }) => {
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
      const { channel, cleanup } = createChannel(rpcMethods, ({ pid }) => {
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
