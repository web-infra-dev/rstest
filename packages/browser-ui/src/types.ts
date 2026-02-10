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
  /** Runner instance identifier used for stale-request protection */
  runId?: string;
  /** Base URL for runner (iframe) pages */
  runnerUrl?: string;
  /** WebSocket port for container RPC */
  wsPort?: number;
  /** Debug mode. When true, enables verbose logging in browser */
  debug?: boolean;
  /** Timeout for RPC operations in milliseconds */
  rpcTimeout?: number;
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

export type TestFileStartPayload = {
  testPath: string;
  projectName: string;
};

export type LogPayload = {
  level: 'log' | 'warn' | 'error' | 'info' | 'debug';
  content: string;
  testPath: string;
  type: 'stdout' | 'stderr';
  trace?: string;
};

export type FatalPayload = {
  message: string;
  stack?: string;
};

export type BrowserClientMessage =
  | { type: 'ready' }
  | {
      type: 'file-start';
      payload: TestFileStartPayload;
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
      payload: FatalPayload;
    }
  | {
      type: 'log';
      payload: LogPayload;
    }
  | {
      type: 'snapshot-rpc-request';
      payload: SnapshotRpcRequest;
    }
  // Generic plugin RPC requests (for decoupled plugins)
  | BrowserPluginRequestMessage
  | { type: string; payload?: unknown };

export type HostRPC = {
  rerunTest: (testFile: string, testNamePattern?: string) => Promise<void>;
  getTestFiles: () => Promise<TestFileInfo[]>;
  onTestFileStart: (payload: TestFileStartPayload) => Promise<void>;
  onTestCaseResult: (payload: BrowserClientTestResult) => Promise<void>;
  onTestFileComplete: (payload: BrowserClientFileResult) => Promise<void>;
  onLog: (payload: LogPayload) => Promise<void>;
  onFatal: (payload: FatalPayload) => Promise<void>;
  resolveSnapshotPath: (testPath: string) => Promise<string>;
  readSnapshotFile: (filepath: string) => Promise<string | null>;
  saveSnapshotFile: (filepath: string, content: string) => Promise<void>;
  removeSnapshotFile: (filepath: string) => Promise<void>;
  dispatch: (
    testFile: string,
    message: BrowserClientMessage,
  ) => Promise<{ namespace: string; response: BrowserPluginResponse } | null>;
};

export type ContainerRPC = {
  onTestFileUpdate: (testFiles: TestFileInfo[]) => void;
  reloadTestFile: (testFile: string, testNamePattern?: string) => void;
};

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

// ============================================================================
// Generic Plugin RPC types (for decoupled plugin architecture)
// ============================================================================

/**
 * Generic plugin RPC request from runner iframe.
 * Plugins identify themselves via namespace (e.g., 'midscene').
 */
export type BrowserPluginRequest = {
  id: string;
  /**
   * Runner instance identifier for stale-request protection.
   * Generated per iframe load/reload.
   */
  runId: string;
  method: string;
  args: unknown[];
};

/**
 * Plugin message from runner iframe to container.
 * Used for the new decoupled plugin architecture.
 */
export type BrowserPluginRequestMessage = {
  type: 'plugin';
  payload: {
    testFile: string;
    namespace: string; // e.g., 'midscene'
    request: BrowserPluginRequest;
  };
};

/**
 * Plugin response from host back to runner iframe.
 */
export type BrowserPluginResponse = {
  id: string;
  result?: unknown;
  error?: string;
};

/**
 * Plugin response envelope sent from container to runner iframe.
 */
export type BrowserPluginResponseEnvelope = {
  type: '__rstest_plugin_response__';
  payload: {
    namespace: string;
    response: BrowserPluginResponse;
  };
};
