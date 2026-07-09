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
} from '../protocol';

// Coincidentally equal to the host-side RUNNER_FRAMES_READY_TIMEOUT_MS and the
// runner's CONFIG_WAIT_TIMEOUT_MS (entry.ts), but a semantically distinct
// default in a different runtime, so deliberately not shared with them.
const DEFAULT_RPC_TIMEOUT_MS = 30_000;

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

/**
 * Build a runner-lifecycle dispatch request.
 *
 * Lifecycle events (`file-ready`, `suite-start`, `suite-result`, `case-start`)
 * share the dispatch-rpc envelope but are delivered fire-and-forget via
 * {@link sendRunnerLifecycle}, so the request id only needs to be unique — it is
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
 * Deliver a runner-lifecycle request fire-and-forget.
 *
 * Unlike {@link dispatchRpc}, this never awaits, unwraps, id-matches, or times
 * out: the host echoes a response but the runner ignores it. Failures surface
 * only through the optional `onError` hook (debug logging at the call site),
 * keeping the hot test loop non-blocking.
 */
export const sendRunnerLifecycle = (
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
    const dispatchBridge = window[DISPATCH_RPC_BRIDGE_NAME];
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
