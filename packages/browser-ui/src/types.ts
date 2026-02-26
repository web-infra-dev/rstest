import type {
  BrowserDispatchRequest,
  BrowserDispatchResponse,
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
      // Keep browser-ui aligned with @rstest/browser dispatch protocol so new
      // namespaces can be routed without introducing extra message variants.
      type: 'dispatch-rpc-request';
      payload: BrowserDispatchRequest;
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
  dispatch: (
    request: BrowserDispatchRequest,
  ) => Promise<BrowserDispatchResponse>;
};

export type ContainerRPC = {
  onTestFileUpdate: (testFiles: TestFileInfo[]) => void;
  reloadTestFile: (testFile: string, testNamePattern?: string) => Promise<void>;
};

export type {
  BrowserDispatchRequest,
  BrowserDispatchResponse,
  BrowserRpcRequest,
  BrowserRpcResponse,
};
