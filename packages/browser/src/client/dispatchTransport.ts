import type {
  BrowserDispatchRequest,
  BrowserDispatchResponse,
} from '../protocol';
import {
  DISPATCH_MESSAGE_TYPE,
  DISPATCH_RESPONSE_TYPE,
  DISPATCH_RPC_REQUEST_TYPE,
} from '../protocol';

export const DEFAULT_RPC_TIMEOUT_MS = 30_000;

export const getRpcTimeout = (): number => {
  return (
    window.__RSTEST_BROWSER_OPTIONS__?.rpcTimeout ?? DEFAULT_RPC_TIMEOUT_MS
  );
};

const pendingRequests = new Map<
  string,
  {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    staleMessage: string;
  }
>();

let requestIdCounter = 0;
let messageListenerInitialized = false;

export const createRequestId = (prefix: string): string => {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  requestIdCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${requestIdCounter.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
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
    pending.reject(new Error(pending.staleMessage));
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

const unwrapDispatchBridgeResult = <T>(
  requestId: string,
  result: unknown,
  staleMessage: string,
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
    throw new Error(staleMessage);
  }
  if (result.error) {
    throw new Error(result.error);
  }
  return result.result as T;
};

export const dispatchRpc = <T>({
  requestId,
  request,
  timeoutMs,
  timeoutMessage,
  staleMessage,
}: {
  requestId: string;
  request: BrowserDispatchRequest;
  timeoutMs: number;
  timeoutMessage: string;
  staleMessage: string;
}): Promise<T> => {
  if (window.parent === window) {
    const dispatchBridge = window.__rstest_dispatch_rpc__;
    if (!dispatchBridge) {
      throw new Error(
        'Dispatch RPC bridge is not available in top-level runner.',
      );
    }

    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(timeoutMessage));
      }, timeoutMs);

      const call = Promise.resolve(dispatchBridge(request)).then((result) =>
        unwrapDispatchBridgeResult<T>(requestId, result, staleMessage),
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
      pendingRequests.delete(requestId);
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    pendingRequests.set(requestId, {
      staleMessage,
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
        type: DISPATCH_MESSAGE_TYPE,
        payload: {
          type: DISPATCH_RPC_REQUEST_TYPE,
          payload: request,
        },
      },
      '*',
    );
  });
};
