import type { BrowserDispatchRequest, SnapshotRpcCall } from '../protocol';
import { DISPATCH_NAMESPACE_SNAPSHOT } from '../protocol';
import {
  createRequestId,
  dispatchRpc,
  getRpcTimeout,
} from './dispatchTransport';
import { SNAPSHOT_HEADER } from '@rstest/core/internal/browser-runtime';
import { mapStackFrame } from './sourceMapSupport';

const createSnapshotDispatchRequest = (
  requestId: string,
  call: SnapshotRpcCall,
): BrowserDispatchRequest => {
  // Snapshot is just one namespace on the shared dispatch RPC channel.
  // Keep this mapping explicit so new runner-side RPC clients can mirror it.
  return {
    requestId,
    namespace: DISPATCH_NAMESPACE_SNAPSHOT,
    method: call.method,
    args: call.args,
  };
};

/**
 * Send a snapshot RPC request to the container (parent window).
 * The container will forward it to the host via WebSocket RPC.
 *
 * `call` is a {@link SnapshotRpcCall}, so `method` and `args` are validated as a
 * pair — a mismatched argument shape fails to compile at the call site.
 */
const sendRpcRequest = <T>(call: SnapshotRpcCall): Promise<T> => {
  const requestId = createRequestId('snapshot-rpc');
  const rpcTimeout = getRpcTimeout();
  const dispatchRequest = createSnapshotDispatchRequest(requestId, call);

  return dispatchRpc<T>({
    requestId,
    request: dispatchRequest,
    timeoutMs: rpcTimeout,
    staleMessage: 'Stale snapshot RPC request ignored.',
    timeoutMessage: `Snapshot RPC timeout after ${rpcTimeout / 1000}s: ${call.method}`,
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
    return sendRpcRequest<string>({
      method: 'resolveSnapshotPath',
      args: { testPath: filepath },
    });
  }

  async prepareDirectory(): Promise<void> {
    // Directory creation is handled by saveSnapshotFile on the host
  }

  async saveSnapshotFile(filepath: string, snapshot: string): Promise<void> {
    await sendRpcRequest<void>({
      method: 'saveSnapshotFile',
      args: { filepath, content: snapshot },
    });
  }

  async readSnapshotFile(filepath: string): Promise<string | null> {
    return sendRpcRequest<string | null>({
      method: 'readSnapshotFile',
      args: { filepath },
    });
  }

  async removeSnapshotFile(filepath: string): Promise<void> {
    await sendRpcRequest<void>({
      method: 'removeSnapshotFile',
      args: { filepath },
    });
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
