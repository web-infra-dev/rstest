import type { BrowserHostConfig } from '../protocol';
import type { BrowserRpcRequest, BrowserRpcResponse } from '../rpcProtocol';

declare global {
  interface Window {
    __RSTEST_BROWSER_OPTIONS__?: BrowserHostConfig;
  }
}

const DEFAULT_RPC_TIMEOUT_MS = 30_000;

const getRpcTimeout = (): number => {
  return (
    window.__RSTEST_BROWSER_OPTIONS__?.rpcTimeout ?? DEFAULT_RPC_TIMEOUT_MS
  );
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

const initMessageListener = (): void => {
  if (messageListenerInitialized) {
    return;
  }
  messageListenerInitialized = true;

  window.addEventListener('message', (event: MessageEvent) => {
    if (event.data?.type === '__rstest_browser_rpc_response__') {
      const response = event.data.payload as BrowserRpcResponse;
      const pending = pendingRequests.get(response.id);
      if (pending) {
        pendingRequests.delete(response.id);
        if (response.error) {
          pending.reject(new Error(response.error));
        } else {
          pending.resolve(response.result);
        }
      }
    }
  });
};

const getCurrentTestPath = (): string => {
  const testPath = window.__RSTEST_BROWSER_OPTIONS__?.testFile;
  if (!testPath) {
    throw new Error(
      'Browser RPC requires testFile in __RSTEST_BROWSER_OPTIONS__. ' +
        'This usually indicates the runner iframe was not configured by the container.',
    );
  }
  return testPath;
};

export const callBrowserRpc = async <T>(
  payload: Omit<BrowserRpcRequest, 'id' | 'testPath'>,
): Promise<T> => {
  initMessageListener();

  const id = `browser-rpc-${++requestIdCounter}`;
  const rpcTimeout = getRpcTimeout();
  const request: BrowserRpcRequest = {
    id,
    testPath: getCurrentTestPath(),
    ...payload,
  };

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
          type: 'browser-rpc-request',
          payload: request,
        },
      },
      '*',
    );
  });
};
