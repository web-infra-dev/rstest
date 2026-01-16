/**
 * AI RPC communication layer for @rstest/midscene.
 *
 * Handles communication between the runner iframe and the container/host
 * for AI operations (aiTap, aiInput, aiAssert, etc.).
 *
 * Uses the unified dispatch protocol (namespace 'midscene'), mirroring the
 * same dual-path pattern used by the snapshot RPC (snapshot.ts):
 *   - Headless: window.__rstest_dispatch_rpc__(request) → BrowserDispatchResponse
 *   - Headed:   window.parent.postMessage + __rstest_dispatch_response__ listener
 */

import {
  AI_RPC_TIMEOUT_MS,
  type AiRpcMethod,
  type AiRpcMethodArgs,
  type AiRpcMethodResult,
  MIDSCENE_NAMESPACE,
} from './protocol';

declare global {
  interface Window {
    __rstest_dispatch_rpc__?: (request: DispatchRequest) => Promise<unknown>;
    __RSTEST_BROWSER_OPTIONS__?: {
      testFile?: string;
    };
  }
}

/** Minimal BrowserDispatchRequest subset (avoids cross-package imports) */
type DispatchRequest = {
  requestId: string;
  namespace: string;
  method: string;
  args: unknown;
  target?: { testFile?: string };
};

/** Minimal BrowserDispatchResponse subset */
type DispatchResponse = {
  requestId: string;
  result?: unknown;
  error?: string;
  stale?: boolean;
};

const DISPATCH_MESSAGE_TYPE = '__rstest_dispatch__';
const DISPATCH_RESPONSE_TYPE = '__rstest_dispatch_response__';

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
};

let requestIdCounter = 0;
const pendingRequests = new Map<string, PendingRequest>();
let messageListenerInitialized = false;

function generateRequestId(): string {
  requestIdCounter += 1;
  return `midscene-rpc-${requestIdCounter}`;
}

function getTestFileFromInjectedOptions(): string | undefined {
  const testFile = window.__RSTEST_BROWSER_OPTIONS__?.testFile;
  return typeof testFile === 'string' && testFile.length > 0
    ? testFile
    : undefined;
}

function getTestFileFromUrl(): string | undefined {
  const url = new URL(window.location.href);
  const testFile = url.searchParams.get('testFile') || undefined;
  return testFile && testFile.length > 0 ? testFile : undefined;
}

function getTestFile(): string {
  // Headless top-level runner does not include `testFile` in URL query.
  const testFile = getTestFileFromInjectedOptions() || getTestFileFromUrl();
  if (!testFile) {
    throw new Error(
      '@rstest/midscene: Cannot determine test file from runtime config or URL. ' +
        'Make sure you are running in rstest browser mode.',
    );
  }
  return testFile;
}

const isDispatchResponse = (value: unknown): value is DispatchResponse => {
  return (
    typeof value === 'object' &&
    value !== null &&
    'requestId' in value &&
    typeof (value as { requestId: unknown }).requestId === 'string'
  );
};

const initMessageListener = (): void => {
  if (messageListenerInitialized) {
    return;
  }
  messageListenerInitialized = true;

  window.addEventListener('message', (event: MessageEvent) => {
    if (event.data?.type !== DISPATCH_RESPONSE_TYPE) {
      return;
    }
    const response = event.data.payload as DispatchResponse;
    const pending = pendingRequests.get(response.requestId);
    if (!pending) {
      return;
    }
    pendingRequests.delete(response.requestId);
    clearTimeout(pending.timeoutHandle);
    if (response.stale) {
      pending.reject(new Error('Stale AI RPC request ignored.'));
    } else if (response.error) {
      pending.reject(new Error(response.error));
    } else {
      pending.resolve(response.result);
    }
  });
};

/**
 * Send an AI RPC request to the host via the unified dispatch protocol.
 * Handles both headless (direct bridge) and headed (iframe postMessage) paths.
 */
export function sendAiRpcRequest<M extends AiRpcMethod>(
  method: M,
  args: AiRpcMethodArgs<M>,
): Promise<AiRpcMethodResult<M>> {
  const requestId = generateRequestId();
  const testFile = getTestFile();

  const dispatchRequest: DispatchRequest = {
    requestId,
    namespace: MIDSCENE_NAMESPACE,
    method,
    args,
    target: { testFile },
  };

  // Headless top-level runner path
  if (window.parent === window) {
    const dispatchBridge = window.__rstest_dispatch_rpc__;
    if (!dispatchBridge) {
      return Promise.reject(
        new Error(
          '@rstest/midscene: Dispatch RPC bridge not available. ' +
            'Midscene AI testing requires rstest browser mode.',
        ),
      );
    }

    return new Promise<AiRpcMethodResult<M>>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        reject(
          new Error(
            `AI RPC request timed out (${AI_RPC_TIMEOUT_MS}ms): ${method}`,
          ),
        );
      }, AI_RPC_TIMEOUT_MS);

      Promise.resolve(dispatchBridge(dispatchRequest))
        .then((raw) => {
          clearTimeout(timeoutHandle);
          if (!isDispatchResponse(raw)) {
            throw new Error('Invalid dispatch bridge response payload.');
          }
          if (raw.requestId !== requestId) {
            throw new Error(
              `Mismatched response id: expected ${requestId}, got ${raw.requestId}`,
            );
          }
          if (raw.stale) {
            throw new Error('Stale AI RPC request ignored.');
          }
          if (raw.error) {
            throw new Error(raw.error);
          }
          resolve(raw.result as AiRpcMethodResult<M>);
        })
        .catch((error: unknown) => {
          clearTimeout(timeoutHandle);
          reject(error instanceof Error ? error : new Error(String(error)));
        });
    });
  }

  // Headed iframe path
  initMessageListener();

  return new Promise<AiRpcMethodResult<M>>((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(
        new Error(
          `AI RPC request timed out (${AI_RPC_TIMEOUT_MS}ms): ${method}`,
        ),
      );
    }, AI_RPC_TIMEOUT_MS);

    pendingRequests.set(requestId, {
      resolve: (value) => resolve(value as AiRpcMethodResult<M>),
      reject,
      timeoutHandle,
    });

    try {
      window.parent.postMessage(
        {
          type: DISPATCH_MESSAGE_TYPE,
          payload: {
            type: 'dispatch-rpc-request',
            payload: dispatchRequest,
          },
        },
        '*',
      );
    } catch (error) {
      pendingRequests.delete(requestId);
      clearTimeout(timeoutHandle);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
