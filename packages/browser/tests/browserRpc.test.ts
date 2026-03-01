import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  rstest,
} from '@rstest/core';
import type { BrowserDispatchResponse } from '../src/protocol';
import {
  DISPATCH_METHOD_RPC,
  DISPATCH_NAMESPACE_BROWSER,
  DISPATCH_RESPONSE_TYPE,
} from '../src/protocol';

type CallBrowserRpc = typeof import('../src/client/browserRpc').callBrowserRpc;

describe('browserRpc client', () => {
  let callBrowserRpc: CallBrowserRpc;
  let mockPostMessage: ReturnType<typeof rstest.fn>;
  let messageHandler: ((event: MessageEvent) => void) | null = null;

  const respond = (response: BrowserDispatchResponse) => {
    if (!messageHandler) {
      throw new Error('message handler is not initialized');
    }
    messageHandler({
      data: {
        type: DISPATCH_RESPONSE_TYPE,
        payload: response,
      },
    } as MessageEvent);
  };

  beforeEach(async () => {
    rstest.resetModules();
    mockPostMessage = rstest.fn();

    rstest.stubGlobal('crypto', {
      randomUUID: rstest.fn(() => 'rpc-id-1'),
    });

    rstest.stubGlobal('window', {
      addEventListener: (
        _type: string,
        handler: (event: MessageEvent) => void,
      ) => {
        messageHandler = handler;
      },
      parent: {
        postMessage: mockPostMessage,
      },
      __RSTEST_BROWSER_OPTIONS__: {
        testFile: '/tests/example.test.ts',
        runId: 'run-1',
        rpcTimeout: 1000,
      },
    });

    const module = await import('../src/client/browserRpc');
    callBrowserRpc = module.callBrowserRpc;
  });

  afterEach(() => {
    rstest.unstubAllGlobals();
    messageHandler = null;
  });

  it('should include runId and uuid request id', async () => {
    const requestPromise = callBrowserRpc<void>({
      kind: 'locator',
      locator: { steps: [] },
      method: 'click',
      args: [],
    });

    expect(mockPostMessage).toHaveBeenCalledTimes(1);
    const postedPayload = mockPostMessage.mock.calls[0]?.[0] as {
      payload?: {
        payload?: {
          requestId?: string;
          namespace?: string;
          method?: string;
          args?: { id?: string; testPath?: string; runId?: string };
        };
      };
    };
    const dispatchRequest = postedPayload.payload?.payload;
    const request = dispatchRequest?.args;

    expect(request?.id).toBe('rpc-id-1');
    expect(request?.testPath).toBe('/tests/example.test.ts');
    expect(request?.runId).toBe('run-1');
    expect(dispatchRequest?.namespace).toBe(DISPATCH_NAMESPACE_BROWSER);
    expect(dispatchRequest?.method).toBe(DISPATCH_METHOD_RPC);

    respond({ requestId: dispatchRequest!.requestId!, result: undefined });
    await expect(requestPromise).resolves.toBeUndefined();
  });

  it('should reject when runId is missing', async () => {
    (window as any).__RSTEST_BROWSER_OPTIONS__ = {
      testFile: '/tests/example.test.ts',
      rpcTimeout: 1000,
    };

    await expect(
      callBrowserRpc<void>({
        kind: 'locator',
        locator: { steps: [] },
        method: 'click',
        args: [],
      }),
    ).rejects.toThrow('Browser RPC requires runId');
  });
});
