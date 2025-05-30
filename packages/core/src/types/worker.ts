import type { SnapshotUpdateState } from '@vitest/snapshot';
import type { SnapshotEnvironment } from '@vitest/snapshot/environment';
import type { RstestContext } from './core';
import type { SourceMapInput } from './reporter';
import type {
  TestFileInfo,
  TestFileResult,
  TestResult,
  UserConsoleLog,
} from './testSuite';
import type { DistPath, TestPath } from './utils';

export type EntryInfo = {
  distPath: DistPath;
  testPath: TestPath;
  files?: string[];
};

/** Server to Runtime */
// biome-ignore lint/complexity/noBannedTypes: TODO
export type ServerRPC = {};

/** Runtime to Server */
export type RuntimeRPC = {
  onTestFileStart: (test: TestFileInfo) => Promise<void>;
  onTestFileResult: (test: TestFileResult) => Promise<void>;
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
  | 'printConsoleTrace'
  | 'disableConsoleIntercept'
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
    type: 'run' | 'collect';
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
  };
};
