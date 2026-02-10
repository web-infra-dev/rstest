import type { DevicePreset } from '@rstest/core/browser';
import type {
  RuntimeConfig,
  Test,
  TestFileResult,
  TestResult,
} from '@rstest/core/browser-runtime';
import type { SnapshotUpdateState } from '@vitest/snapshot';

export type SerializedRuntimeConfig = RuntimeConfig;

export type BrowserViewport =
  | {
      width: number;
      height: number;
    }
  | DevicePreset;

export type BrowserProjectRuntime = {
  name: string;
  environmentName: string;
  projectRoot: string;
  runtimeConfig: SerializedRuntimeConfig;
  viewport?: BrowserViewport;
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
   * Runner instance identifier used for stale-request protection.
   * Changes on each iframe load/reload.
   */
  runId?: string;
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
  /**
   * Debug mode. When true, enables verbose logging in browser.
   */
  debug?: boolean;
  /**
   * Timeout for RPC operations in milliseconds (e.g., snapshot file operations).
   * Derived from testTimeout config.
   */
  rpcTimeout?: number;
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
  // Generic plugin RPC requests (from runner iframe to container for decoupled plugins)
  | BrowserPluginRequestMessage;

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
 * The container forwards these to the host, which routes to the appropriate plugin handler.
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
