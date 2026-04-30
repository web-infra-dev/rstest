import { type BirpcOptions, type BirpcReturn, createBirpc } from 'birpc';
import { isRpcEnvelope, wrapRpc } from '../../pool/protocol';
import type { RuntimeRPC, ServerRPC } from '../../types';

export type WorkerRPC = BirpcReturn<RuntimeRPC, ServerRPC>;

const processSend = process.send!.bind(process);
const processOn = process.on.bind(process);
const processOff = process.off.bind(process);

type WorkerRpcOptions = Pick<
  BirpcOptions<ServerRPC>,
  'on' | 'post' | 'serialize' | 'deserialize'
>;

export function createForksRpcOptions({
  dispose = [],
}: {
  dispose?: (() => void)[];
}): WorkerRpcOptions {
  return {
    post(v) {
      processSend(wrapRpc(v));
    },
    on(fn) {
      const handler = (message: any, ...extras: any) => {
        if (!isRpcEnvelope(message)) {
          return;
        }
        return fn(message.payload, ...extras);
      };
      processOn('message', handler);
      dispose.push(() => processOff('message', handler));
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
