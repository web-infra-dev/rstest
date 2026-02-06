/**
 * Browser UI types
 *
 * These types are derived from @rstest/core's protocol types but simplified
 * for the browser UI's needs. The UI only needs a subset of the full config.
 */

export type BrowserProjectRuntime = {
  name: string;
  environmentName: string;
  projectRoot: string;
  runtimeConfig: Record<string, unknown>;
  viewport?:
    | {
        width: number;
        height: number;
      }
    | string;
};

/**
 * Test file info with associated project name.
 * Used to track which project a test file belongs to.
 */
export type TestFileInfo = {
  testPath: string;
  projectName: string;
};

export type BrowserHostConfig = {
  rootPath: string;
  projects: BrowserProjectRuntime[];
  snapshot: {
    updateSnapshot: unknown;
  };
  /** If provided, only run this specific test file */
  testFile?: string;
  /** Base URL for runner (iframe) pages */
  runnerUrl?: string;
  /** WebSocket port for container RPC */
  wsPort?: number;
  /** Debug mode. When true, enables verbose logging in browser */
  debug?: boolean;
};

export type BrowserClientTestResult = {
  testId: string;
  status: 'skip' | 'pass' | 'fail' | 'todo';
  name: string;
  testPath: string;
  parentNames?: string[];
  location?: {
    line: number;
    column?: number;
    file?: string;
  };
};

export type BrowserClientFileResult = BrowserClientTestResult & {
  results: BrowserClientTestResult[];
};

export type BrowserClientMessage =
  | { type: 'ready' }
  | {
      type: 'file-start';
      payload: { testPath: string; projectName: string };
    }
  | {
      type: 'case-result';
      payload: BrowserClientTestResult;
    }
  | {
      type: 'file-complete';
      payload: BrowserClientFileResult;
    }
  | {
      type: 'fatal';
      payload: { message: string; stack?: string };
    }
  | {
      type: 'snapshot-rpc-request';
      payload: SnapshotRpcRequest;
    }
  | { type: string; payload?: unknown };

/**
 * Snapshot RPC request from runner iframe.
 * The container will forward these to the host via WebSocket RPC.
 */
export type SnapshotRpcRequest =
  | {
      id: string;
      method: 'resolveSnapshotPath';
      args: { testPath: string };
    }
  | {
      id: string;
      method: 'readSnapshotFile';
      args: { filepath: string };
    }
  | {
      id: string;
      method: 'saveSnapshotFile';
      args: { filepath: string; content: string };
    }
  | {
      id: string;
      method: 'removeSnapshotFile';
      args: { filepath: string };
    };

/**
 * Snapshot RPC response from container to runner iframe.
 */
export type SnapshotRpcResponse = {
  id: string;
  result?: unknown;
  error?: string;
};
