import type { BrowserViewport } from '@rstest/core/internal/browser';
import type {
  RuntimeConfig,
  TestFileResult,
  TestInfo,
  TestResult,
} from '@rstest/core/internal/browser-runtime';
import type { SnapshotUpdateState } from '@vitest/snapshot';

export type {
  BrowserLocatorIR,
  BrowserRpcRequest,
  SnapshotRpcCall,
  SnapshotRpcMethod,
  SnapshotRpcMethodArgs,
  SnapshotRpcRequest,
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

// `BrowserViewport` is a core config type (`@rstest/core` owns the canonical
// definition used by `NormalizedBrowserModeConfig`). Re-export it so the host
// assigns the SAME type across the seam instead of a hand-copied duplicate.
export type { BrowserViewport };

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

/**
 * Wire shape of a `log` client message payload. The host receives this and maps
 * it onto core's {@link UserConsoleLog} (notably `level` → `name`); that mapper
 * (`hostController.ts` `handleLog`) annotates its result as `UserConsoleLog`, so
 * the map→core direction is compiler-checked. Owning the wire shape here as one
 * named type keeps the host's input type from drifting away from the producer.
 */
export type BrowserLogPayload = {
  level: 'log' | 'warn' | 'error' | 'info' | 'debug';
  content: string;
  taskId?: string;
  taskName?: string;
  taskParentNames?: string[];
  taskType?: 'file' | 'suite' | 'case';
  testPath: string;
  type: 'stdout' | 'stderr';
  trace?: string;
};

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
  | { type: 'log'; payload: BrowserLogPayload }
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
 * Lifecycle methods the runner emits via `dispatchRunnerLifecycle()` as
 * dispatch-rpc-requests on the `runner` namespace (as opposed to the
 * {@link BrowserClientMessage} types it `send()`s). The runner client imports
 * this instead of redeclaring the list, so the emit site cannot drift from the
 * host router.
 */
export type RunnerLifecycleMethod =
  'file-ready' | 'suite-start' | 'suite-result' | 'case-start';

/**
 * {@link BrowserClientMessage} types that are forwarded to the `runner`
 * namespace (by message `type`) rather than handled at the transport layer.
 * `Extract` keeps this a checked subset of the message union — renaming a
 * message type drops it here, surfacing as a missing handler downstream.
 */
type RunnerMessageMethod = Extract<
  BrowserClientMessage['type'],
  'file-start' | 'case-result' | 'file-complete' | 'log' | 'fatal'
>;

/**
 * Single source of truth for every method handled by the `runner` dispatch
 * namespace. The host handler table is keyed by this union (a missing key is a
 * compile error), so adding a runner method here forces a matching handler and
 * cannot silently no-op at runtime.
 */
export type RunnerDispatchMethod = RunnerLifecycleMethod | RunnerMessageMethod;

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
  // Routing reads `namespace`, `method`, `runToken`, and `target.sessionId`
  // (see dispatchRouter.ts / dispatchBrowserRpcRequest). `target.testFile` and
  // `target.projectName` are carried for diagnostics / forward-compatibility and
  // are NOT consulted for routing today — adding a routing-relevant field here
  // means wiring a reader on the host side, which structural typing won't force.
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

export type BrowserDispatchHandler = (
  request: BrowserDispatchRequest,
) => Promise<unknown>;
