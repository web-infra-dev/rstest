import type {
  BrowserDispatchRequest,
  BrowserDispatchResponse,
} from '../protocol';
import {
  DISPATCH_MESSAGE_TYPE,
  DISPATCH_NAMESPACE_RUNNER,
  DISPATCH_RESPONSE_TYPE,
  DISPATCH_RPC_BRIDGE_NAME,
  DISPATCH_RPC_REQUEST_TYPE,
  NO_RPC_TIMEOUT,
} from '../protocol';

export const getRpcTimeout = (): number => {
  const configuredTimeout = window.__RSTEST_BROWSER_OPTIONS__?.rpcTimeout;
  return configuredTimeout !== undefined && configuredTimeout > 0
    ? configuredTimeout
    : NO_RPC_TIMEOUT;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  staleMessage: string;
  timeoutId?: ReturnType<typeof setTimeout>;
};

const pendingRequests = new Map<string, PendingRequest>();

let requestIdCounter = 0;
let messageListenerInitialized = false;
let messageListener: ((event: MessageEvent) => void) | undefined;

export const createRequestId = (prefix: string): string => {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  requestIdCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${requestIdCounter.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

/**
 * Build a runner-lifecycle dispatch request.
 *
 * Lifecycle events (`file-ready`, `suite-start`, `suite-result`, `case-start`)
 * share the dispatch-rpc envelope but are delivered fire-and-forget via
 * {@link sendDispatchRequest}, so the request id only needs to be unique — it is
 * produced by the shared {@link createRequestId} factory rather than a bespoke
 * per-runner counter.
 */
export const createRunnerLifecycleRequest = (
  method: string,
  args: unknown,
): BrowserDispatchRequest => ({
  requestId: createRequestId('runner-lifecycle'),
  namespace: DISPATCH_NAMESPACE_RUNNER,
  method,
  args,
});

/**
 * Deliver a dispatch request fire-and-forget.
 *
 * Unlike {@link dispatchRpc}, this never awaits, unwraps, id-matches, or times
 * out: the host echoes a response but the runner ignores it. Failures surface
 * only through the optional `onError` hook (debug logging at the call site),
 * keeping the hot test loop non-blocking.
 */
export const sendDispatchRequest = (
  request: BrowserDispatchRequest,
  onError?: (error: unknown) => void,
): void => {
  if (window.parent === window) {
    const dispatchBridge = window[DISPATCH_RPC_BRIDGE_NAME];
    if (!dispatchBridge) {
      onError?.(
        new Error('Dispatch RPC bridge is not available in top-level runner.'),
      );
      return;
    }
    void Promise.resolve(dispatchBridge(request)).catch((error: unknown) => {
      onError?.(error);
    });
    return;
  }

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

const takePendingRequest = (requestId: string): PendingRequest | undefined => {
  const pending = pendingRequests.get(requestId);
  if (!pending) {
    return undefined;
  }

  pendingRequests.delete(requestId);
  if (pending.timeoutId !== undefined) {
    clearTimeout(pending.timeoutId);
  }
  return pending;
};

const rejectPendingRequest = (requestId: string, error: Error): void => {
  takePendingRequest(requestId)?.reject(error);
};

const settlePendingRequest = (response: BrowserDispatchResponse): void => {
  const pending = takePendingRequest(response.requestId);
  if (!pending) {
    return;
  }

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

export const disposeDispatchTransport = (
  error: Error = new Error('Browser RPC transport disposed.'),
): void => {
  for (const requestId of pendingRequests.keys()) {
    rejectPendingRequest(requestId, error);
  }

  if (messageListenerInitialized && messageListener) {
    window.removeEventListener('message', messageListener);
  }
  messageListener = undefined;
  messageListenerInitialized = false;
};

const initMessageListener = (): void => {
  if (messageListenerInitialized) {
    return;
  }
  messageListenerInitialized = true;

  messageListener = (event: MessageEvent) => {
    if (event.data?.type === DISPATCH_RESPONSE_TYPE) {
      settlePendingRequest(event.data.payload as BrowserDispatchResponse);
    }
  };
  window.addEventListener('message', messageListener);
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
    const dispatchBridge = window[DISPATCH_RPC_BRIDGE_NAME];
    if (!dispatchBridge) {
      throw new Error(
        'Dispatch RPC bridge is not available in top-level runner.',
      );
    }

    return new Promise<T>((resolve, reject) => {
      const pending: PendingRequest = {
        staleMessage,
        resolve: (value) => resolve(value as T),
        reject,
      };
      pendingRequests.set(requestId, pending);
      if (timeoutMs >= 0) {
        pending.timeoutId = setTimeout(() => {
          rejectPendingRequest(requestId, new Error(timeoutMessage));
        }, timeoutMs);
      }

      const call = Promise.resolve()
        .then(() => dispatchBridge(request))
        .then((result) =>
          unwrapDispatchBridgeResult<T>(requestId, result, staleMessage),
        );

      call
        .then((result) => {
          takePendingRequest(requestId)?.resolve(result);
        })
        .catch((error) => {
          rejectPendingRequest(
            requestId,
            error instanceof Error ? error : new Error(String(error)),
          );
        });
    });
  }

  initMessageListener();

  return new Promise<T>((resolve, reject) => {
    const pending: PendingRequest = {
      staleMessage,
      resolve: (value) => {
        resolve(value as T);
      },
      reject: (error) => {
        reject(error);
      },
    };
    pendingRequests.set(requestId, pending);
    if (timeoutMs >= 0) {
      pending.timeoutId = setTimeout(() => {
        rejectPendingRequest(requestId, new Error(timeoutMessage));
      }, timeoutMs);
    }

    try {
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
    } catch (error) {
      rejectPendingRequest(
        requestId,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  });
};
