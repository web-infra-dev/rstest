/**
 * AI RPC communication layer for @rstest/midscene.
 *
 * This module handles communication between the runner iframe and the
 * container/host for AI operations.
 */

import {
  AI_RPC_TIMEOUT_MS,
  type AiRpcMethod,
  type AiRpcMethodArgs,
  type AiRpcMethodResult,
  type AiRpcRequest,
  type AiRpcResponse,
  MIDSCENE_NAMESPACE,
} from './protocol';

type PendingRequest = {
  resolve: (response: AiRpcResponse) => void;
  reject: (error: Error) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
};

type PluginResponseMessage = {
  type: '__rstest_plugin_response__';
  payload: {
    namespace: string;
    response: AiRpcResponse;
  };
};

let requestCounter = 0;
const pendingRequests = new Map<string, PendingRequest>();
let initialized = false;

function generateRequestId(): string {
  requestCounter += 1;
  return `ai-rpc-${requestCounter}-${Date.now()}`;
}

function getTestFile(): string {
  const url = new URL(window.location.href);
  const testFile = url.searchParams.get('testFile');
  if (!testFile) {
    throw new Error(
      '@rstest/midscene: Cannot determine test file from URL. ' +
        'Make sure you are running in rstest browser mode.',
    );
  }
  return testFile;
}

function getRunId(): string {
  const url = new URL(window.location.href);
  const runId = url.searchParams.get('runId');
  if (!runId) {
    throw new Error(
      '@rstest/midscene: Cannot determine runId from URL. ' +
        'Make sure you are running with a compatible @rstest/browser version.',
    );
  }
  return runId;
}

function onPluginResponse(response: AiRpcResponse): void {
  const pending = pendingRequests.get(response.id);
  if (!pending) {
    return;
  }

  pendingRequests.delete(response.id);
  clearTimeout(pending.timeoutHandle);

  if (response.error) {
    pending.reject(new Error(response.error));
    return;
  }

  pending.resolve(response);
}

/**
 * Initialize the AI RPC client.
 */
export function initAiRpc(): void {
  if (initialized) {
    return;
  }
  initialized = true;

  window.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as PluginResponseMessage | undefined;
    if (data?.type !== '__rstest_plugin_response__') {
      return;
    }

    const { namespace, response } = data.payload;
    if (namespace !== MIDSCENE_NAMESPACE) {
      return;
    }

    onPluginResponse(response);
  });
}

/**
 * Send an AI RPC request to the container/host.
 */
export function sendAiRpcRequest<M extends AiRpcMethod>(
  method: M,
  args: AiRpcMethodArgs<M>,
): Promise<AiRpcMethodResult<M>> {
  initAiRpc();

  const id = generateRequestId();
  const request: AiRpcRequest<M> = {
    id,
    runId: getRunId(),
    method,
    args,
  };
  const testFile = getTestFile();

  return new Promise<AiRpcMethodResult<M>>((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      if (!pendingRequests.has(id)) {
        return;
      }

      pendingRequests.delete(id);
      reject(new Error(`AI RPC request timed out: ${method}`));
    }, AI_RPC_TIMEOUT_MS);

    pendingRequests.set(id, {
      resolve: (response) => resolve(response.result as AiRpcMethodResult<M>),
      reject,
      timeoutHandle,
    });

    try {
      window.parent.postMessage(
        {
          type: '__rstest_dispatch__',
          payload: {
            type: 'plugin',
            payload: {
              testFile,
              namespace: MIDSCENE_NAMESPACE,
              request,
            },
          },
        },
        '*',
      );
    } catch (error) {
      pendingRequests.delete(id);
      clearTimeout(timeoutHandle);
      reject(error as Error);
    }
  });
}
