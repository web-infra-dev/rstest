import type { DevicePreset } from '@rstest/core/browser';
import type {
  RuntimeConfig,
  TestFileResult,
  TestInfo,
  TestResult,
} from '@rstest/core/browser-runtime';
import type { SnapshotUpdateState } from '@vitest/snapshot';

export type {
  BrowserLocatorIR,
  BrowserLocatorStep,
  BrowserLocatorText,
  BrowserRpcRequest,
  BrowserRpcResponse,
  SnapshotRpcRequest,
  SnapshotRpcResponse,
} from './rpcProtocol';
export { validateBrowserRpcRequest } from './rpcProtocol';

export const DISPATCH_MESSAGE_TYPE = '__rstest_dispatch__';
export const DISPATCH_RESPONSE_TYPE = '__rstest_dispatch_response__';
export const DISPATCH_RPC_BRIDGE_NAME = '__rstest_dispatch_rpc__';
export const DISPATCH_RPC_REQUEST_TYPE = 'dispatch-rpc-request';
export const RSTEST_CONFIG_MESSAGE_TYPE = 'RSTEST_CONFIG';

export const DISPATCH_NAMESPACE_RUNNER = 'runner';
export const DISPATCH_NAMESPACE_BROWSER = 'browser';
export const DISPATCH_NAMESPACE_SNAPSHOT = 'snapshot';
export const DISPATCH_METHOD_RPC = 'rpc';

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
      payload: { testPath: string; project: string; tests: TestInfo[] };
    }
  | { type: 'collect-complete' }
  // Unified RPC envelope for all runner -> container/host capability calls.
  // Snapshot already uses this path via namespace "snapshot". Future PR #948
  // capabilities can add new namespaces instead of adding new message types.
  | {
      type: typeof DISPATCH_RPC_REQUEST_TYPE;
      payload: BrowserDispatchRequest;
    };

/**
 * Transport-agnostic envelope used by host routing.
 * `namespace + method + args + target` describes an operation independent of
 * the underlying message channel, and `runToken` provides run-level isolation.
 */
export type BrowserDispatchRequest = {
  requestId: string;
  // Optional so headed/container paths can adopt the same envelope even when
  // run-token isolation is only enforced in headless scheduling today.
  runToken?: number;
  namespace: string;
  method: string;
  args?: unknown;
  target?: {
    testFile?: string;
    sessionId?: string;
    projectName?: string;
  };
};

/**
 * Dispatch response envelope.
 * `stale: true` signals a safe drop from an older run generation, not a failure.
 */
export type BrowserDispatchResponse = {
  requestId: string;
  runToken?: number;
  result?: unknown;
  error?: string;
  stale?: boolean;
};

export type BrowserDispatchResponseEnvelope = {
  type: typeof DISPATCH_RESPONSE_TYPE;
  payload: BrowserDispatchResponse;
};

export type BrowserDispatchHandler = (
  request: BrowserDispatchRequest,
) => Promise<unknown>;
