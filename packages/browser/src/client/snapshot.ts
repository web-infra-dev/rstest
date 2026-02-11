import type {
  BrowserDispatchRequest,
  BrowserDispatchResponse,
  BrowserHostConfig,
  SnapshotRpcRequest,
} from '../protocol';
import { mapStackFrame } from './sourceMapSupport';

declare global {
  interface Window {
    __RSTEST_BROWSER_OPTIONS__?: BrowserHostConfig;
    __rstest_dispatch_rpc__?: (
      request: BrowserDispatchRequest,
    ) => Promise<unknown>;
  }
}

const SNAPSHOT_HEADER = '// Rstest Snapshot';
const DISPATCH_RESPONSE_TYPE = '__rstest_dispatch_response__';

/** Default RPC timeout if not specified in config (30 seconds) */
const DEFAULT_RPC_TIMEOUT_MS = 30_000;

/**
 * Get RPC timeout from browser options or use default.
 */
const getRpcTimeout = (): number => {
  return (
    window.__RSTEST_BROWSER_OPTIONS__?.rpcTimeout ?? DEFAULT_RPC_TIMEOUT_MS
  );
};

/**
 * Pending RPC requests waiting for responses from the container.
 */
const pendingRequests = new Map<
  string,
  {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }
>();

let requestIdCounter = 0;
let messageListenerInitialized = false;

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
    pending.reject(new Error('Stale snapshot RPC request ignored.'));
    return;
  }
  if (response.error) {
    pending.reject(new Error(response.error));
    return;
  }
  pending.resolve(response.result);
};

/**
 * Initialize the message listener for snapshot RPC responses.
 * This is called once when the first RPC request is made.
 */
const initMessageListener = (): void => {
  if (messageListenerInitialized) {
    return;
  }
  messageListenerInitialized = true;

  window.addEventListener('message', (event: MessageEvent) => {
    if (event.data?.type === DISPATCH_RESPONSE_TYPE) {
      const response = event.data.payload as BrowserDispatchResponse;
      settlePendingRequest(response);
    }
  });
};

const createSnapshotDispatchRequest = (
  requestId: string,
  method: SnapshotRpcRequest['method'],
  args: SnapshotRpcRequest['args'],
): BrowserDispatchRequest => {
  // Snapshot is just one namespace on the shared dispatch RPC channel.
  // Keep this mapping explicit so new runner-side RPC clients can mirror it.
  return {
    requestId,
    namespace: 'snapshot',
    method,
    args,
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
    throw new Error('Stale snapshot RPC request ignored.');
  }
  if (result.error) {
    throw new Error(result.error);
  }
  return result.result as T;
};

/**
 * Send a snapshot RPC request to the container (parent window).
 * The container will forward it to the host via WebSocket RPC.
 */
const sendRpcRequest = <T>(
  method: SnapshotRpcRequest['method'],
  args: SnapshotRpcRequest['args'],
): Promise<T> => {
  const requestId = `snapshot-rpc-${++requestIdCounter}`;
  const rpcTimeout = getRpcTimeout();
  const dispatchRequest = createSnapshotDispatchRequest(
    requestId,
    method,
    args,
  );

  if (window.parent === window) {
    // Headless top-level runner path: all RPC namespaces go through one bridge.
    const dispatchBridge = window.__rstest_dispatch_rpc__;
    if (!dispatchBridge) {
      return Promise.reject(
        new Error('Dispatch RPC bridge is not available in top-level runner.'),
      );
    }

    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(
          new Error(
            `Snapshot RPC timeout after ${rpcTimeout / 1000}s: ${method}`,
          ),
        );
      }, rpcTimeout);

      const call = Promise.resolve(dispatchBridge(dispatchRequest)).then(
        (result) => unwrapDispatchBridgeResult<T>(requestId, result),
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
    // Set a timeout for the RPC call
    const timeoutId = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(
        new Error(
          `Snapshot RPC timeout after ${rpcTimeout / 1000}s: ${method}`,
        ),
      );
    }, rpcTimeout);

    pendingRequests.set(requestId, {
      resolve: (value) => {
        clearTimeout(timeoutId);
        resolve(value as T);
      },
      reject: (error) => {
        clearTimeout(timeoutId);
        reject(error);
      },
    });

    // Send request to parent window (container)
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

/**
 * Browser snapshot environment that proxies file operations to the host
 * via postMessage RPC through the container.
 */
export class BrowserSnapshotEnvironment {
  getVersion(): string {
    return '1';
  }

  getHeader(): string {
    return `${SNAPSHOT_HEADER} v${this.getVersion()}`;
  }

  async resolveRawPath(_testPath: string, rawPath: string): Promise<string> {
    return rawPath;
  }

  async resolvePath(filepath: string): Promise<string> {
    return sendRpcRequest<string>('resolveSnapshotPath', {
      testPath: filepath,
    });
  }

  async prepareDirectory(): Promise<void> {
    // Directory creation is handled by saveSnapshotFile on the host
  }

  async saveSnapshotFile(filepath: string, snapshot: string): Promise<void> {
    await sendRpcRequest<void>('saveSnapshotFile', {
      filepath,
      content: snapshot,
    });
  }

  async readSnapshotFile(filepath: string): Promise<string | null> {
    return sendRpcRequest<string | null>('readSnapshotFile', { filepath });
  }

  async removeSnapshotFile(filepath: string): Promise<void> {
    await sendRpcRequest<void>('removeSnapshotFile', { filepath });
  }

  /**
   * Process stack trace for inline snapshots.
   * Maps bundled URLs back to original source file paths.
   */
  processStackTrace(stack: {
    file: string;
    line: number;
    column: number;
    method: string;
  }): { file: string; line: number; column: number; method: string } {
    const mapped = mapStackFrame(stack);
    return {
      file: mapped.file,
      line: mapped.line,
      column: mapped.column,
      method: mapped.method || stack.method,
    };
  }
}
