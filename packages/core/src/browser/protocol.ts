import type { SnapshotUpdateState } from '@vitest/snapshot';
import type { RuntimeConfig, Test, TestFileResult, TestResult } from '../types';

export type SerializedRuntimeConfig = RuntimeConfig;

export type BrowserProjectRuntime = {
  name: string;
  environmentName: string;
  projectRoot: string;
  runtimeConfig: SerializedRuntimeConfig;
};

/**
 * Test file info with associated project name.
 * Used to track which project a test file belongs to.
 */
export type TestFileInfo = {
  testPath: string;
  projectName: string;
};

/**
 * Execution mode for browser tests.
 * - 'run': Execute tests and report results (default)
 * - 'collect': Only collect test metadata without running
 */
export type BrowserExecutionMode = 'run' | 'collect';

export type BrowserHostConfig = {
  rootPath: string;
  projects: BrowserProjectRuntime[];
  snapshot: {
    updateSnapshot: SnapshotUpdateState;
  };
  testFile?: string; // Optional: if provided, only run this specific test file
  /**
   * Base URL for runner (iframe) pages.
   */
  runnerUrl?: string;
  /**
   * WebSocket port for container RPC.
   */
  wsPort?: number;
  /**
   * Execution mode. Defaults to 'run'.
   */
  mode?: BrowserExecutionMode;
};

export type BrowserClientMessage =
  | { type: 'ready' }
  | {
      type: 'file-start';
      payload: { testPath: string; projectName: string };
    }
  | { type: 'case-result'; payload: TestResult }
  | { type: 'file-complete'; payload: TestFileResult }
  | {
      type: 'log';
      payload: {
        level: 'log' | 'warn' | 'error' | 'info' | 'debug';
        content: string;
        testPath: string;
        type: 'stdout' | 'stderr';
        trace?: string;
      };
    }
  | {
      type: 'fatal';
      payload: { message: string; stack?: string };
    }
  | { type: 'complete' }
  // Collect mode messages
  | {
      type: 'collect-result';
      payload: { testPath: string; project: string; tests: Test[] };
    }
  | { type: 'collect-complete' }
  // Snapshot RPC requests (from runner iframe to container)
  | {
      type: 'snapshot-rpc-request';
      payload: SnapshotRpcRequest;
    }
  // Frame RPC requests (from runner iframe to container for Playwright control)
  | {
      type: 'frame-rpc-request';
      payload: { testFile: string; request: FrameRpcRequest };
    }
  // AI RPC requests (from runner iframe to container for Midscene AI operations)
  | {
      type: 'ai-rpc-request';
      payload: { testFile: string; request: AiRpcRequest };
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
  // Click operations
  | {
      id: string;
      method: 'click';
      args: { selector: string; options?: FrameMouseClickOptions };
    }
  // Mouse operations
  | {
      id: string;
      method: 'mouse.click';
      args: { x: number; y: number; options?: FrameMouseClickOptions };
    }
  | {
      id: string;
      method: 'mouse.dblclick';
      args: {
        x: number;
        y: number;
        options?: { button?: 'left' | 'right' | 'middle' };
      };
    }
  | {
      id: string;
      method: 'mouse.move';
      args: { x: number; y: number; steps?: number };
    }
  | {
      id: string;
      method: 'mouse.down';
      args: { button?: 'left' | 'right' | 'middle' };
    }
  | {
      id: string;
      method: 'mouse.up';
      args: { button?: 'left' | 'right' | 'middle' };
    }
  | {
      id: string;
      method: 'mouse.wheel';
      args: { deltaX: number; deltaY: number };
    }
  // Keyboard operations
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
      method: 'keyboard.down';
      args: { key: string };
    }
  | {
      id: string;
      method: 'keyboard.up';
      args: { key: string };
    }
  // Screenshot
  | {
      id: string;
      method: 'screenshot';
      args: { fullPage?: boolean };
    }
  // Evaluate JavaScript
  | {
      id: string;
      method: 'evaluate';
      args: { expression: string };
    }
  // Get viewport size
  | {
      id: string;
      method: 'getViewportSize';
      args: Record<string, never>;
    }
  // Get URL
  | {
      id: string;
      method: 'getUrl';
      args: Record<string, never>;
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
