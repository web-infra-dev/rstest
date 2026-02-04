import type {
  BrowserDispatchRequest,
  BrowserDispatchResponse,
  BrowserHostConfig,
} from '../protocol';
import type { BrowserRpcRequest } from '../rpcProtocol';

declare global {
  interface Window {
    __RSTEST_BROWSER_OPTIONS__?: BrowserHostConfig;
    __rstest_dispatch_rpc__?: (
      request: BrowserDispatchRequest,
    ) => Promise<unknown>;
  }
}

const DEFAULT_RPC_TIMEOUT_MS = 30_000;
const DISPATCH_RESPONSE_TYPE = '__rstest_dispatch_response__';

const getRpcTimeout = (): number => {
  return (
    window.__RSTEST_BROWSER_OPTIONS__?.rpcTimeout ?? DEFAULT_RPC_TIMEOUT_MS
  );
};

const getUrlSearchParam = (name: string): string | undefined => {
  try {
    const value = new URL(window.location.href).searchParams.get(name);
    return value ?? undefined;
  } catch {
    return undefined;
  }
};

const pendingRequests = new Map<
  string,
  {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }
>();

let requestIdCounter = 0;
let messageListenerInitialized = false;

const createRequestId = (): string => {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  requestIdCounter += 1;
  return `browser-rpc-${Date.now().toString(36)}-${requestIdCounter.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

const isDispatchResponse = (
  value: unknown,
): value is BrowserDispatchResponse => {
  return (
    typeof value === 'object' &&
    value !== null &&
    'requestId' in value &&
    typeof (value as { requestId: unknown }).requestId === 'string'
  );
};

const settlePendingRequest = (response: BrowserDispatchResponse): void => {
  const pending = pendingRequests.get(response.requestId);
  if (!pending) {
    return;
  }

  pendingRequests.delete(response.requestId);
  if (response.stale) {
    pending.reject(new Error('Stale browser RPC request ignored.'));
    return;
  }
  if (response.error) {
    pending.reject(new Error(response.error));
    return;
  }
  pending.resolve(response.result);
};

const initMessageListener = (): void => {
  if (messageListenerInitialized) {
    return;
  }
  messageListenerInitialized = true;

  window.addEventListener('message', (event: MessageEvent) => {
    if (event.data?.type === DISPATCH_RESPONSE_TYPE) {
      settlePendingRequest(event.data.payload as BrowserDispatchResponse);
    }
  });
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
    namespace: 'browser',
    method: 'rpc',
    args: request,
    target: {
      testFile: request.testPath,
    },
  };
};

const unwrapDispatchBridgeResult = <T>(
  requestId: string,
  result: unknown,
): T => {
  if (!isDispatchResponse(result)) {
    throw new Error('Invalid dispatch bridge response payload.');
  }

  if (result.requestId !== requestId) {
    throw new Error(
      `Mismatched dispatch response id: expected ${requestId}, got ${result.requestId}`,
    );
  }
  if (result.stale) {
    throw new Error('Stale browser RPC request ignored.');
  }
  if (result.error) {
    throw new Error(result.error);
  }
  return result.result as T;
};

export const callBrowserRpc = async <T>(
  payload: Omit<BrowserRpcRequest, 'id' | 'testPath' | 'runId'>,
): Promise<T> => {
  const id = createRequestId();
  const rpcTimeout = getRpcTimeout();
  const request: BrowserRpcRequest = {
    id,
    testPath: getCurrentTestPath(),
    runId: getCurrentRunId(),
    ...payload,
  };
  const dispatchRequest = createBrowserDispatchRequest(id, request);

  if (window.parent === window) {
    const dispatchBridge = window.__rstest_dispatch_rpc__;
    if (!dispatchBridge) {
      throw new Error(
        'Dispatch RPC bridge is not available in top-level runner.',
      );
    }

    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(
          new Error(
            `Browser RPC timeout after ${rpcTimeout / 1000}s: ${request.kind}.${request.method}`,
          ),
        );
      }, rpcTimeout);

      const call = Promise.resolve(dispatchBridge(dispatchRequest)).then(
        (res) => unwrapDispatchBridgeResult<T>(id, res),
      );

      call
        .then((result) => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timeoutId);
          reject(error instanceof Error ? error : new Error(String(error)));
        });
    });
  }

  initMessageListener();

  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      pendingRequests.delete(id);
      reject(
        new Error(
          `Browser RPC timeout after ${rpcTimeout / 1000}s: ${request.kind}.${request.method}`,
        ),
      );
    }, rpcTimeout);

    pendingRequests.set(id, {
      resolve: (value) => {
        clearTimeout(timeoutId);
        resolve(value as T);
      },
      reject: (error) => {
        clearTimeout(timeoutId);
        reject(error);
      },
    });

    window.parent.postMessage(
      {
        type: '__rstest_dispatch__',
        payload: {
          type: 'dispatch-rpc-request',
          payload: dispatchRequest,
        },
      },
      '*',
    );
  });
};
