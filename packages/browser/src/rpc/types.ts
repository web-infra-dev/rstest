import type { TestFileResult, TestResult } from '@rstest/core/browser';
import type { BirpcReturn } from 'birpc';
import type { TestFileInfo } from '../protocol';

export type TestFileStartPayload = {
  testPath: string;
  projectName: string;
};

export type LogPayload = {
  level: 'log' | 'warn' | 'error' | 'info' | 'debug';
  content: string;
  testPath: string;
  type: 'stdout' | 'stderr';
  trace?: string;
};

export type FatalPayload = {
  message: string;
  stack?: string;
};

export type HostRpcMethods = {
  rerunTest: (testFile: string, testNamePattern?: string) => Promise<void>;
  getTestFiles: () => Promise<TestFileInfo[]>;
  onContainerReady: () => Promise<void>;
  onTestFileStart: (payload: TestFileStartPayload) => Promise<void>;
  onTestCaseResult: (payload: TestResult) => Promise<void>;
  onTestFileComplete: (payload: TestFileResult) => Promise<void>;
  onLog: (payload: LogPayload) => Promise<void>;
  onFatal: (payload: FatalPayload) => Promise<void>;
  resolveSnapshotPath: (testPath: string) => Promise<string>;
  readSnapshotFile: (filepath: string) => Promise<string | null>;
  saveSnapshotFile: (filepath: string, content: string) => Promise<void>;
  removeSnapshotFile: (filepath: string) => Promise<void>;
};

export type ContainerRpcMethods = {
  onTestFileUpdate: (testFiles: TestFileInfo[]) => Promise<void>;
  reloadTestFile: (testFile: string, testNamePattern?: string) => Promise<void>;
};

export type ContainerRpc = BirpcReturn<ContainerRpcMethods, HostRpcMethods>;
