import type {
  BrowserDispatchRequest,
  BrowserDispatchResponse,
  BrowserHostConfig,
  BrowserProjectRuntime,
  RunnerEnvelope,
  TestFileInfo,
  VersionedTestFileSet,
} from '@rstest/browser/protocol';

import type {
  TestFileResult,
  TestInfo,
  TestResult,
} from '@rstest/core/internal/browser-runtime';

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

export type TestFileReadyPayload = {
  testPath: string;
  tests: TestInfo[];
};

export type TestCaseStartPayload = Extract<TestInfo, { type: 'case' }>;

/**
 * Host RPC surface. Runner lifecycle events have no dedicated methods: the
 * container relays every runner message as a `dispatch` request on the
 * `runner` namespace, stamped with the envelope's run identity, so the host
 * has exactly one inbound gate.
 */
export type HostRPC = {
  rerunTest: (testFile: string, testNamePattern?: string) => Promise<void>;
  getTestFiles: () => Promise<VersionedTestFileSet>;
  onFrameSetReady: (version: number) => Promise<void>;
  dispatch: (
    request: BrowserDispatchRequest,
  ) => Promise<BrowserDispatchResponse>;
};

export type ContainerRPC = {
  onTestFileUpdate: (testFiles: TestFileInfo[], version: number) => void;
  /**
   * Grant the host-minted `runId` to this file's frame and navigate it.
   * Identity travels in; the container never mints or echoes one back.
   */
  reloadTestFile: (
    testFile: string,
    runId: string,
    testNamePattern?: string,
  ) => Promise<void>;
  /**
   * Watch reruns push a refreshed host config (e.g. a flipped
   * `snapshot.updateSnapshot`) so runner iframes loaded from now on receive
   * live values instead of the boot-time snapshot.
   */
  onHostConfigUpdate: (config: BrowserHostConfig) => void;
};

export type {
  BrowserDispatchRequest,
  BrowserDispatchResponse,
  BrowserHostConfig,
  BrowserProjectRuntime,
  RunnerEnvelope,
  TestFileInfo,
  VersionedTestFileSet,
};
