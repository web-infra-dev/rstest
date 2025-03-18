import { createRequire } from 'node:module';
import path from 'node:path';
import v8 from 'node:v8';
import vm from 'node:vm';
import { type BirpcOptions, type BirpcReturn, createBirpc } from 'birpc';
import type { TinypoolWorkerMessage } from 'tinypool';
import * as RstestAPI from '../api';
import { type TestResult, runner } from '../runner';
import type { RunWorkerOptions, RunnerRPC, RuntimeRPC } from '../types';
import { logger } from '../utils/logger';

export type WorkerRPC = BirpcReturn<RuntimeRPC, RunnerRPC>;

const processSend = process.send!.bind(process);
const processOn = process.on!.bind(process);
const processOff = process.off!.bind(process);
const dispose: (() => void)[] = [];

export type WorkerRpcOptions = Pick<
  BirpcOptions<RunnerRPC>,
  'on' | 'post' | 'serialize' | 'deserialize'
>;

export function createForksRpcOptions(
  nodeV8: typeof import('v8') = v8,
): WorkerRpcOptions {
  return {
    serialize: nodeV8.serialize,
    deserialize: (v) => nodeV8.deserialize(Buffer.from(v)),
    post(v) {
      processSend(v);
    },
    on(fn) {
      const handler = (message: any, ...extras: any) => {
        // Do not react on Tinypool's internal messaging
        if ((message as TinypoolWorkerMessage)?.__tinypool_worker_message__) {
          return;
        }
        return fn(message, ...extras);
      };
      processOn('message', handler);
      dispose.push(() => processOff('message', handler));
    },
  };
}

export function createRuntimeRpc(
  options: Pick<
    BirpcOptions<void>,
    'on' | 'post' | 'serialize' | 'deserialize'
  >,
): { rpc: WorkerRPC } {
  const rpc = createBirpc<RuntimeRPC, any>(
    {},
    {
      ...options,
    },
  );

  return {
    rpc,
  };
}

const runInPool = async ({
  entryInfo: { filePath, originPath },
}: RunWorkerOptions['options']): Promise<TestResult> => {
  const { rpc } = createRuntimeRpc(createForksRpcOptions());

  const codeContent = await rpc.readFile(filePath);
  const fileDir = path.dirname(originPath);

  const localModule = {
    children: [],
    exports: {},
    filename: originPath,
    id: originPath,
    isPreloading: false,
    loaded: false,
    path: fileDir,
  };

  const context = {
    module: localModule,
    require: createRequire(originPath),
    __dirname: fileDir,
    __filename: originPath,
    global: {
      '@rstest/core': RstestAPI,
    },
  };

  const code = `'use strict';(${Object.keys(context).join(',')})=>{{
   ${codeContent}
  }}`;
  try {
    const fn = vm.runInThisContext(code);
    fn(...Object.values(context));

    if (runner.suites.length === 0) {
      logger.error(`No test suites found in file: ${originPath}`);
    }

    const results = await runner.run();

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
