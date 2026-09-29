type RpcMessage = { e?: unknown };

type SerializedRpcError = { name: string; message: string; stack?: string };

function isSerializedRpcError(value: unknown): value is SerializedRpcError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as SerializedRpcError).message === 'string'
  );
}

/**
 * birpc sends a thrown value as-is in a response's `e` field, and the worker
 * IPC channel is JSON, which turns an `Error` into `{}`. Carry errors as plain
 * fields and rebuild them on the receiving side so callers still get an
 * `Error` with the original message. Both ends of the channel must use this.
 */
export const rpcErrorCodec = {
  serialize: (message: RpcMessage): RpcMessage => {
    const { e } = message;
    if (!(e instanceof Error)) return message;
    return {
      ...message,
      e: { name: e.name, message: e.message, stack: e.stack },
    };
  },
  deserialize: (message: RpcMessage): RpcMessage => {
    const { e } = message;
    if (!isSerializedRpcError(e)) return message;
    const error = new Error(e.message);
    error.name = e.name;
    error.stack = e.stack;
    return { ...message, e: error };
  },
};
