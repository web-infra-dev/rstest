import type {
  BrowserRpcRequest,
  BrowserRpcResponse,
} from '@rstest/browser/protocol';

/**
 * Browser UI types
 *
 * Keep protocol types (locator IR + snapshot/browser RPC) in sync with
 * @rstest/browser by importing from the shared source.
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
  /** Per-run identifier for stale browser RPC protection */
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
  | {
      type: 'browser-rpc-request';
      payload: BrowserRpcRequest;
    }
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
  dispatchBrowserRpc: (request: BrowserRpcRequest) => Promise<unknown>;
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

export type { BrowserRpcRequest, BrowserRpcResponse };
