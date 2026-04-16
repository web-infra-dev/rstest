import type {
  BrowserDispatchRequest,
  BrowserDispatchResponse,
  BrowserHostConfig,
  BrowserProjectRuntime,
  BrowserRpcRequest,
  BrowserClientMessage as ProtocolBrowserClientMessage,
  TestFileInfo,
} from '@rstest/browser/protocol';

import type {
  TestFileResult,
  TestInfo,
  TestResult,
} from '@rstest/core/browser-runtime';

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
  runId?: string;
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

export type TestFileReadyPayload = {
  testPath: string;
  tests: TestInfo[];
};

export type TestCaseStartPayload = Extract<TestInfo, { type: 'case' }>;

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
  onRunnerFramesReady: (testFiles: string[]) => Promise<void>;
  onTestFileStart: (payload: TestFileStartPayload) => Promise<void>;
  onTestCaseResult: (payload: BrowserClientTestResult) => Promise<void>;
  onTestFileComplete: (payload: BrowserClientFileResult) => Promise<void>;
  onLog: (payload: LogPayload) => Promise<void>;
  onFatal: (payload: FatalPayload) => Promise<void>;
  dispatch: (
    request: BrowserDispatchRequest,
  ) => Promise<BrowserDispatchResponse>;
};

export type ReloadTestFileAck = {
  runId: string;
};

export type ContainerRPC = {
  onTestFileUpdate: (testFiles: TestFileInfo[]) => void;
  reloadTestFile: (
    testFile: string,
    testNamePattern?: string,
  ) => Promise<ReloadTestFileAck>;
};

export type {
  BrowserDispatchRequest,
  BrowserDispatchResponse,
  BrowserHostConfig,
  BrowserProjectRuntime,
  BrowserRpcRequest,
  TestFileInfo,
};
