/**
 * RPC communication layer for @rstest/midscene
 *
 * This module handles the communication between the runner iframe and the
 * container/host for frame operations.
 */

import type { FrameRpcRequest, FrameRpcResponse } from './protocol';

/** Pending request callback */
type PendingRequest = {
  resolve: (response: FrameRpcResponse) => void;
  reject: (error: Error) => void;
};

/** Request counter for generating unique IDs */
let requestCounter = 0;

/** Map of pending requests by ID */
const pendingRequests = new Map<string, PendingRequest>();

/** Whether the RPC client is initialized */
let initialized = false;

/**
 * Generate a unique request ID
 */
function generateRequestId(): string {
  return `frame-rpc-${++requestCounter}-${Date.now()}`;
}

/**
 * Initialize the Frame RPC client.
 * This sets up the message listener for responses from the container.
 */
export function initFrameRpc(): void {
  if (initialized) {
    return;
  }
  initialized = true;

  window.addEventListener('message', (event: MessageEvent) => {
    if (event.data?.type === '__rstest_frame_response__') {
      const response = event.data.payload as FrameRpcResponse;
      const pending = pendingRequests.get(response.id);
      if (pending) {
        pendingRequests.delete(response.id);
        if (response.error) {
          pending.reject(new Error(response.error));
        } else {
          pending.resolve(response);
        }
      }
    }
  });
}

/**
 * Get the current test file from URL params
 */
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

/**
 * Send a Frame RPC request to the container/host.
 * The container will forward it to the host via WebSocket RPC.
 */
export function sendFrameRpcRequest(
  request: Omit<FrameRpcRequest, 'id'>,
): Promise<FrameRpcResponse> {
  // Ensure RPC is initialized
  initFrameRpc();

  const id = generateRequestId();
  const fullRequest = { ...request, id } as FrameRpcRequest;
  const testFile = getTestFile();

  return new Promise<FrameRpcResponse>((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });

    // Send via postMessage to parent (container)
    window.parent.postMessage(
      {
        type: '__rstest_dispatch__',
        payload: {
          type: 'frame-rpc-request',
          payload: { testFile, request: fullRequest },
        },
      },
      '*',
    );

    // Set timeout for request
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error(`Frame RPC request timed out: ${request.method}`));
      }
    }, 30000);
  });
}
