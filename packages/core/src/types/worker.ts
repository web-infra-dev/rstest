import type { SnapshotUpdateState } from '@vitest/snapshot';
import type { SnapshotEnvironment } from '@vitest/snapshot/environment';
import type { ProjectContext, RstestContext } from './core';
import type { TestFileInfo, TestResult, UserConsoleLog } from './testSuite';
import type { DistPath, TestPath } from './utils';

export type EntryInfo = {
  distPath: DistPath;
  chunks: (string | number)[];
  testPath: TestPath;
  files?: string[];
};

/** Server to Runtime */
// biome-ignore lint/complexity/noBannedTypes: TODO
export type ServerRPC = {};

/** Runtime to Server */
export type RuntimeRPC = {
  onTestFileStart: (test: TestFileInfo) => Promise<void>;
  getAssetsByEntry: () => Promise<{
    assetFiles: Record<string, string>;
    sourceMaps: Record<string, string>;
  }>;
  onTestCaseResult: (result: TestResult) => Promise<void>;
  getCountOfFailedTests: () => Promise<number>;
  onConsoleLog: (log: UserConsoleLog) => void;
  resolveSnapshotPath: (filepath: string) => string;
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
  | 'printConsoleTrace'
  | 'disableConsoleIntercept'
  | 'testEnvironment'
  | 'isolate'
  | 'hookTimeout'
  | 'coverage'
  | 'snapshotFormat'
  | 'env'
  | 'logHeapUsage'
  | 'bail'
  | 'chaiConfig'
>;

export type WorkerContext = {
  rootPath: RstestContext['rootPath'];
  projectRoot: ProjectContext['rootPath'];
  project: string;
  runtimeConfig: RuntimeConfig;
  taskId: number;
};

export type RunWorkerOptions = {
  options: {
    entryInfo: EntryInfo;
    setupEntries: EntryInfo[];
    context: WorkerContext;
    updateSnapshot: SnapshotUpdateState;
    type: 'run' | 'collect';
    /** assets is only defined when memory is sufficient, otherwise we should get them via rpc getAssetsByEntry method */
    assets?: {
      assetFiles: Record<string, string>;
      sourceMaps: Record<string, string>;
    };
  };
  rpcMethods: RuntimeRPC;
};

export type WorkerState = WorkerContext & {
  environment: string;
  testPath: TestPath;
  distPath: DistPath;
  snapshotOptions: {
    updateSnapshot: SnapshotUpdateState;
    snapshotEnvironment: SnapshotEnvironment;
    snapshotFormat: RuntimeConfig['snapshotFormat'];
  };
};
