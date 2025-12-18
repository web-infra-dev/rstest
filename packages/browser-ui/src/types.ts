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
  | {
      type: 'frame-rpc-request';
      payload: { testFile: string; request: FrameRpcRequest };
    }
  | {
      type: 'ai-rpc-request';
      payload: { testFile: string; request: AiRpcRequest };
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

// ============================================================================
// Frame RPC types for @rstest/midscene
// ============================================================================

/**
 * Mouse click options
 */
export type FrameMouseClickOptions = {
  button?: 'left' | 'right' | 'middle';
  clickCount?: number;
  delay?: number;
};

/**
 * Frame RPC request from runner iframe to control Playwright Frame.
 * The container will forward these to the host via WebSocket RPC.
 */
export type FrameRpcRequest =
  | {
      id: string;
      method: 'click';
      args: { selector: string; options?: FrameMouseClickOptions };
    }
  | {
      id: string;
      method: 'mouse.click';
      args: { x: number; y: number; options?: FrameMouseClickOptions };
    }
  | {
      id: string;
      method: 'keyboard.type';
      args: { text: string; delay?: number };
    }
  | {
      id: string;
      method: 'keyboard.press';
      args: { key: string; delay?: number };
    }
  | {
      id: string;
      method: 'screenshot';
      args: { fullPage?: boolean };
    }
  | {
      id: string;
      method: 'evaluate';
      args: { expression: string };
    };

/**
 * Frame RPC response from host to runner iframe.
 */
export type FrameRpcResponse = {
  id: string;
  result?: unknown;
  error?: string;
};

// ============================================================================
// AI RPC types for @rstest/midscene Agent integration
// ============================================================================

/**
 * AI RPC methods supported by the host
 */
export type AiRpcMethod =
  | 'aiTap'
  | 'aiRightClick'
  | 'aiDoubleClick'
  | 'aiHover'
  | 'aiInput'
  | 'aiKeyboardPress'
  | 'aiScroll'
  | 'aiAct'
  | 'aiQuery'
  | 'aiAssert'
  | 'aiWaitFor'
  | 'aiLocate'
  | 'aiBoolean'
  | 'aiNumber'
  | 'aiString';

/**
 * AI RPC request from runner iframe to execute Midscene AI operations.
 * The container will forward these to the host via WebSocket RPC.
 */
export type AiRpcRequest = {
  id: string;
  method: AiRpcMethod;
  args: unknown[];
};

/**
 * AI RPC response from host to runner iframe.
 */
export type AiRpcResponse = {
  id: string;
  result?: unknown;
  error?: string;
};
