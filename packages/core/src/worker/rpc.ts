import v8 from 'node:v8';
import { type BirpcOptions, type BirpcReturn, createBirpc } from 'birpc';
import type { TinypoolWorkerMessage } from 'tinypool';
import type { RuntimeRPC, ServerRPC } from '../types';

export type WorkerRPC = BirpcReturn<RuntimeRPC, ServerRPC>;

const processSend = process.send!.bind(process);
const processOn = process.on!.bind(process);
const processOff = process.off!.bind(process);
const dispose: (() => void)[] = [];

export type WorkerRpcOptions = Pick<
  BirpcOptions<ServerRPC>,
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
  const rpc = createBirpc<RuntimeRPC, ServerRPC>({}, options);

  return {
    rpc,
  };
}
