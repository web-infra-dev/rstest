import { type BirpcOptions, type BirpcReturn, createBirpc } from 'birpc';
import { isRpcEnvelope, wrapRpc } from '../../pool/protocol';
import type { RuntimeRPC, ServerRPC } from '../../types';
import { channel } from './channels';

export type WorkerRPC = BirpcReturn<RuntimeRPC, ServerRPC>;

type WorkerRpcOptions = Pick<
  BirpcOptions<ServerRPC>,
  'on' | 'post' | 'serialize' | 'deserialize'
>;

export function createWorkerRpcOptions({
  dispose = [],
}: {
  dispose?: (() => void)[];
}): WorkerRpcOptions {
  return {
    post(v) {
      channel.send(wrapRpc(v));
    },
    on(fn) {
      const handler = (message: any, ...extras: any) => {
        if (!isRpcEnvelope(message)) {
          return;
        }
        return fn(message.payload, ...extras);
      };
      channel.on(handler);
      dispose.push(() => channel.off(handler));
    },
  };
}

export function createRuntimeRpc(
  options: Pick<BirpcOptions, 'on' | 'post' | 'serialize' | 'deserialize'>,
  createBirpcImpl: typeof createBirpc = createBirpc,
): { rpc: WorkerRPC } {
  const rpc = createBirpcImpl<RuntimeRPC, ServerRPC>(
    {},
    {
      ...options,
      // Disable timeout for worker RPC calls, as some operations may take a long time and we don't want them to fail due to timeout.
      timeout: -1,
    },
  );

  return {
    rpc,
  };
}
