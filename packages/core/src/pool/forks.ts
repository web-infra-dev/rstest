import EventEmitter from 'node:events';
import { resolve } from 'node:path';
import v8 from 'node:v8';
import { createBirpc } from 'birpc';
import { type Options, Tinypool } from 'tinypool';
import type {
  RunWorkerOptions,
  RuntimeRPC,
  ServerRPC,
  TestResult,
} from '../types';

function createChannel(rpcMethods: RuntimeRPC) {
  const emitter = new EventEmitter();
  const cleanup = () => emitter.removeAllListeners();

  const events = { message: 'message', response: 'response' };
  const channel = {
    onMessage: (callback: any) => {
      emitter.on(events.message, callback);
    },
    postMessage: (message: any) => {
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
  runTest: (options: RunWorkerOptions) => Promise<TestResult>;
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
    filename: resolve(import.meta.dirname, './worker.js'),
    env,
    execArgv,
    maxThreads,
    minThreads,
    concurrentTasksPerWorker: 1,
    isolateWorkers: isolate,
  };

  const pool = new Tinypool(options);

  return {
    name: 'forks',
    runTest: async ({ options, rpcMethods }: RunWorkerOptions) => {
      const { channel, cleanup } = createChannel(rpcMethods);
      try {
        return await pool.run(options, { channel });
      } finally {
        cleanup();
      }
    },
    close: () => pool.destroy(),
  };
};
