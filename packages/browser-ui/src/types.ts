import type {
  BrowserDispatchRequest,
  BrowserDispatchResponse,
  BrowserHostConfig,
  BrowserProjectRuntime,
  BrowserRpcRequest,
  BrowserRpcResponse,
  BrowserClientMessage as ProtocolBrowserClientMessage,
  TestFileInfo,
} from '@rstest/browser/protocol';

import type { TestFileResult, TestResult } from '@rstest/core/browser-runtime';

/**
 * Browser UI types
 *
 * Keep protocol types (locator IR + snapshot/browser RPC) in sync with
 * @rstest/browser by importing from the shared source.
 */

export type BrowserClientTestResult = {
  testId: TestResult['testId'];
  status: TestResult['status'];
  name: TestResult['name'];
  testPath: TestResult['testPath'];
  parentNames?: TestResult['parentNames'];
  location?: {
    line: number;
    column?: number;
    file?: string;
  };
};

export type BrowserClientFileResult = {
  testId: TestFileResult['testId'];
  status: TestFileResult['status'];
  name: TestFileResult['name'];
  testPath: TestFileResult['testPath'];
  parentNames?: TestFileResult['parentNames'];
  location?: {
    line: number;
    column?: number;
    file?: string;
  };
  results: BrowserClientTestResult[];
};

export type TestFileStartPayload = Extract<
  ProtocolBrowserClientMessage,
  { type: 'file-start' }
>['payload'];

export type LogPayload = Extract<
  ProtocolBrowserClientMessage,
  { type: 'log' }
>['payload'];

export type FatalPayload = Extract<
  ProtocolBrowserClientMessage,
  { type: 'fatal' }
>['payload'];

export type BrowserClientMessage =
  | ProtocolBrowserClientMessage
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
  BrowserHostConfig,
  BrowserProjectRuntime,
  BrowserDispatchRequest,
  BrowserDispatchResponse,
  BrowserRpcRequest,
  BrowserRpcResponse,
  TestFileInfo,
};
