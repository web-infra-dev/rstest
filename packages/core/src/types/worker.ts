import type { SnapshotUpdateState } from '@vitest/snapshot';
import type { SnapshotEnvironment } from '@vitest/snapshot/environment';
import type { RstestContext } from './core';
import type { TestFileInfo, TestResult } from './testSuite';

export type EntryInfo = {
  filePath: string;
  originPath: string;
};

/** Server to Runtime */
// biome-ignore lint/complexity/noBannedTypes: TODO
export type ServerRPC = {};

/** Runtime to Server */
export type RuntimeRPC = {
  onTestFileStart: (test: TestFileInfo) => Promise<void>;
  onTestCaseResult: (result: TestResult) => Promise<void>;
};

export type WorkerContext = Pick<
  RstestContext,
  'normalizedConfig' | 'rootPath'
>;

export type RunWorkerOptions = {
  options: {
    entryInfo: EntryInfo;
    setupEntries: EntryInfo[];
    assetFiles: Record<string, string>;
    context: WorkerContext;
    updateSnapshot: SnapshotUpdateState;
  };
  rpcMethods: RuntimeRPC;
};

export type WorkerState = WorkerContext & {
  environment: string;
  /** Test file source code path */
  sourcePath: string;
  /** Test file path (distPath) */
  filePath: string;
  snapshotOptions: {
    updateSnapshot: SnapshotUpdateState;
    snapshotEnvironment: SnapshotEnvironment;
  };
};
