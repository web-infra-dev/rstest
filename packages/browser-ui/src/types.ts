/**
 * Browser UI types
 *
 * Keep protocol types (locator IR + snapshot/browser RPC) in sync with
 * @rstest/browser by importing from the shared source.
 */

import type {
  BrowserHostConfig,
  BrowserLocatorIR,
  BrowserLocatorStep,
  BrowserLocatorText,
  BrowserProjectRuntime,
  BrowserRpcRequest,
  BrowserRpcResponse,
  SnapshotRpcRequest,
  SnapshotRpcResponse,
  TestFileInfo,
} from '@rstest/browser/protocol';

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
      type: 'browser-rpc-request';
      payload: BrowserRpcRequest;
    }
  | { type: string; payload?: unknown };

export type {
  BrowserHostConfig,
  BrowserProjectRuntime,
  BrowserLocatorIR,
  BrowserLocatorStep,
  BrowserLocatorText,
  BrowserRpcRequest,
  BrowserRpcResponse,
  SnapshotRpcRequest,
  SnapshotRpcResponse,
  TestFileInfo,
};
