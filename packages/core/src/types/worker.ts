import type { SnapshotUpdateState } from '@vitest/snapshot';
import type { SnapshotEnvironment } from '@vitest/snapshot/environment';
import type { RstestContext } from './core';
import type { SourceMapInput } from './reporter';
import type { TestFileInfo, TestResult, UserConsoleLog } from './testSuite';

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
  onConsoleLog: (log: UserConsoleLog) => void;
};

export type RuntimeConfig = Pick<
  RstestContext['normalizedConfig'],
  | 'testTimeout'
  | 'testNamePattern'
  | 'globals'
  | 'passWithNoTests'
  | 'retry'
  | 'clearMocks'
  | 'resetMocks'
  | 'restoreMocks'
  | 'unstubEnvs'
  | 'unstubGlobals'
  | 'maxConcurrency'
>;

export type WorkerContext = {
  rootPath: RstestContext['rootPath'];
  runtimeConfig: RuntimeConfig;
};

export type RunWorkerOptions = {
  options: {
    entryInfo: EntryInfo;
    setupEntries: EntryInfo[];
    assetFiles: Record<string, string>;
    sourceMaps: Record<string, SourceMapInput>;
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
