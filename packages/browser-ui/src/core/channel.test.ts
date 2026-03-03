import { DISPATCH_RESPONSE_TYPE } from '@rstest/browser/protocol';
import { describe, expect, it, rstest } from '@rstest/core';
import { forwardDispatchRpcRequest } from './channel';

describe('forwardDispatchRpcRequest', () => {
  it('should forward dispatch request and reply with host response', async () => {
    const sourceWindow = {
      postMessage: rstest.fn(),
    } as unknown as MessageEventSource;

    const rpc = {
      dispatch: rstest.fn().mockResolvedValue({
        requestId: 'req-1',
        result: { ok: true },
      }),
    };

    await forwardDispatchRpcRequest(
      rpc,
      {
        requestId: 'req-1',
        namespace: 'snapshot',
        method: 'readSnapshotFile',
      },
      sourceWindow,
    );

    expect(rpc.dispatch).toHaveBeenCalledWith({
      requestId: 'req-1',
      namespace: 'snapshot',
      method: 'readSnapshotFile',
    });
    expect((sourceWindow as any).postMessage).toHaveBeenCalledWith(
      {
        type: DISPATCH_RESPONSE_TYPE,
        payload: {
          requestId: 'req-1',
          result: { ok: true },
        },
      },
      '*',
    );
  });

  it('should return error when rpc is not ready', async () => {
    const sourceWindow = {
      postMessage: rstest.fn(),
    } as unknown as MessageEventSource;

    await forwardDispatchRpcRequest(
      null,
      {
        requestId: 'req-2',
        namespace: 'snapshot',
        method: 'readSnapshotFile',
      },
      sourceWindow,
    );

    expect((sourceWindow as any).postMessage).toHaveBeenCalledWith(
      {
        type: DISPATCH_RESPONSE_TYPE,
        payload: {
          requestId: 'req-2',
          error: 'Container RPC is not ready for dispatch.',
        },
      },
      '*',
    );
  });

  it('should reject invalid request payload with structured error response', async () => {
    const sourceWindow = {
      postMessage: rstest.fn(),
    } as unknown as MessageEventSource;

    const rpc = {
      dispatch: rstest.fn(),
    };

    await forwardDispatchRpcRequest(
      rpc,
      { method: 'readSnapshotFile' },
      sourceWindow,
    );

    expect(rpc.dispatch).not.toHaveBeenCalled();
    expect((sourceWindow as any).postMessage).toHaveBeenCalledWith(
      {
        type: DISPATCH_RESPONSE_TYPE,
        payload: {
          requestId: 'unknown-request',
          error:
            'Invalid dispatch request payload: expected an object with string requestId.',
        },
      },
      '*',
    );
  });
});
