import type { BrowserDispatchRequest } from '../protocol';
import { DISPATCH_METHOD_RPC, DISPATCH_NAMESPACE_BROWSER } from '../protocol';
import type { BrowserRpcRequest } from '../rpcProtocol';
import {
  createRequestId,
  dispatchRpc,
  getRpcTimeout,
} from './dispatchTransport';

const getUrlSearchParam = (name: string): string | undefined => {
  try {
    const value = new URL(window.location.href).searchParams.get(name);
    return value ?? undefined;
  } catch {
    return undefined;
  }
};

const getCurrentTestPath = (): string => {
  const testPath =
    window.__RSTEST_BROWSER_OPTIONS__?.testFile ??
    getUrlSearchParam('testFile');
  if (!testPath) {
    throw new Error(
      'Browser RPC requires testFile in __RSTEST_BROWSER_OPTIONS__. ' +
        'This usually indicates the runner iframe was not configured by the container or URL.',
    );
  }
  return testPath;
};

const getCurrentRunId = (): string => {
  const runId =
    window.__RSTEST_BROWSER_OPTIONS__?.runId ?? getUrlSearchParam('runId');
  if (!runId) {
    throw new Error(
      'Browser RPC requires runId in __RSTEST_BROWSER_OPTIONS__. ' +
        'This usually indicates the runner iframe URL/config is stale or incomplete.',
    );
  }
  return runId;
};

const createBrowserDispatchRequest = (
  requestId: string,
  request: BrowserRpcRequest,
): BrowserDispatchRequest => {
  return {
    requestId,
    namespace: DISPATCH_NAMESPACE_BROWSER,
    method: DISPATCH_METHOD_RPC,
    args: request,
    target: {
      testFile: request.testPath,
    },
  };
};

export const callBrowserRpc = async <T>(
  payload: Omit<BrowserRpcRequest, 'id' | 'testPath' | 'runId'>,
): Promise<T> => {
  const id = createRequestId('browser-rpc');
  const rpcTimeout = getRpcTimeout();
  const request: BrowserRpcRequest = {
    id,
    testPath: getCurrentTestPath(),
    runId: getCurrentRunId(),
    ...payload,
  };
  const dispatchRequest = createBrowserDispatchRequest(id, request);

  return dispatchRpc<T>({
    requestId: id,
    request: dispatchRequest,
    timeoutMs: rpcTimeout,
    staleMessage: 'Stale browser RPC request ignored.',
    timeoutMessage: `Browser RPC timeout after ${rpcTimeout / 1000}s: ${request.kind}.${request.method}`,
  });
};
