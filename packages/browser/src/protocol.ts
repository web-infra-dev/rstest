import type { DevicePreset } from '@rstest/core/browser';
import type {
  RuntimeConfig,
  Test,
  TestFileResult,
  TestResult,
} from '@rstest/core/browser-runtime';
import type { SnapshotUpdateState } from '@vitest/snapshot';
import type { BrowserRpcRequest, SnapshotRpcRequest } from './rpcProtocol';

export type {
  BrowserLocatorIR,
  BrowserLocatorStep,
  BrowserLocatorText,
  BrowserRpcRequest,
  BrowserRpcResponse,
  SnapshotRpcRequest,
  SnapshotRpcResponse,
} from './rpcProtocol';

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
   * Per-run identifier assigned by the container.
   * Used by browser RPC calls to prevent stale requests from previous reruns.
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
  // Browser API RPC requests (from runner iframe to container)
  | {
      type: 'browser-rpc-request';
      payload: BrowserRpcRequest;
    };
