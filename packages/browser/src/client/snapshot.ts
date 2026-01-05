import type {
  BrowserHostConfig,
  SnapshotRpcRequest,
  SnapshotRpcResponse,
} from '../protocol';
import { mapStackFrame } from './sourceMapSupport';

declare global {
  interface Window {
    __RSTEST_BROWSER_OPTIONS__?: BrowserHostConfig;
  }
}

const SNAPSHOT_HEADER = '// Rstest Snapshot';

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
    if (event.data?.type === '__rstest_snapshot_response__') {
      const response = event.data.payload as SnapshotRpcResponse;
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

/**
 * Send a snapshot RPC request to the container (parent window).
 * The container will forward it to the host via WebSocket RPC.
 */
const sendRpcRequest = <T>(
  method: SnapshotRpcRequest['method'],
  args: SnapshotRpcRequest['args'],
): Promise<T> => {
  initMessageListener();

  const id = `snapshot-rpc-${++requestIdCounter}`;
  const rpcTimeout = getRpcTimeout();

  return new Promise<T>((resolve, reject) => {
    // Set a timeout for the RPC call
    const timeoutId = setTimeout(() => {
      pendingRequests.delete(id);
      reject(
        new Error(
          `Snapshot RPC timeout after ${rpcTimeout / 1000}s: ${method}`,
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

    // Send request to parent window (container)
    window.parent.postMessage(
      {
        type: '__rstest_dispatch__',
        payload: {
          type: 'snapshot-rpc-request',
          payload: { id, method, args },
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
