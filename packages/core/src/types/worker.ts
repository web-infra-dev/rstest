import type { SnapshotClient, SnapshotUpdateState } from '@vitest/snapshot';
import type { SnapshotEnvironment } from '@vitest/snapshot/environment';
import type { EnvironmentName } from './config';
import type { ProjectContext, RstestContext } from './core';
import type { RstestPoolType } from './config';
import type {
  TestCaseInfo,
  TestFileInfo,
  TestResult,
  TestSuiteInfo,
  UserConsoleLog,
} from './testSuite';
import type { DistPath, TestPath } from './utils';

export type EntryInfo = {
  distPath: DistPath;
  runtimeDistPath?: DistPath;
  chunks: (string | number)[];
  testPath: TestPath;
  files?: string[];
  /**
   * Bundle size (in bytes) of this entry's emitted assets, including its
   * dependency graph. Used as the cold-start cost proxy when ordering test
   * files that have no cached duration yet. Only populated for test entries.
   */
  size?: number;
};

export type Base64AssetFile = {
  encoding: 'base64';
  data: string;
};

/** Asset representation accepted by every node worker transport. */
export type AssetFileContent = string | Uint8Array | Base64AssetFile;

export type AssetFiles = Record<string, AssetFileContent>;

/** Server to Runtime */
export type ServerRPC = object;

/** Runtime to Server */
export type RuntimeRPC = {
  onTestFileStart: (test: TestFileInfo) => Promise<void>;
  onTestFileReady: (test: TestFileInfo) => Promise<void>;
  getAssetsByEntry: (
    assetNames?: string[],
    sourceMapNames?: string[],
  ) => Promise<{
    assetFiles: AssetFiles;
    sourceMaps: Record<string, string>;
  }>;
  onTestSuiteStart: (test: TestSuiteInfo) => Promise<void>;
  onTestSuiteResult: (result: TestResult) => Promise<void>;
  onTestCaseStart: (test: TestCaseInfo) => Promise<void>;
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
  | 'federation'
  | 'isolate'
  | 'hookTimeout'
  | 'coverage'
  | 'snapshotFormat'
  | 'expect'
  | 'env'
  | 'logHeapUsage'
  | 'detectAsyncLeaks'
  | 'bail'
  | 'chaiConfig'
  | 'includeTaskLocation'
  | 'silent'
>;

/**
 * The browser-mode wire projection of {@link RuntimeConfig}. Node-only fields
 * the browser client never reads are stripped so they cannot ship unrouted
 * (the #1389 class):
 * - `testEnvironment`: the client hardcodes `environment: 'browser'`.
 * - `coverage`: browser coverage is host-wired, not client-read.
 * - `logHeapUsage` / `detectAsyncLeaks`: node process mechanisms.
 *
 * These fields stay REQUIRED on `RuntimeConfig` (node worker consumers
 * destructure them unconditionally); only the browser wire narrows.
 */
export type BrowserRuntimeConfig = Omit<
  RuntimeConfig,
  'testEnvironment' | 'detectAsyncLeaks' | 'logHeapUsage' | 'coverage'
>;

export type TestEnvironmentModuleReference = {
  name: Exclude<EnvironmentName, 'node'>;
  packageName: string;
  /** Native module entry resolved through Rstest's environment resolution roots. */
  resolvedPath: string;
  /** Optional ESM prebundle. Loading falls back to `resolvedPath`. */
  bundlePath?: string;
};

export type CurrentTaskInfo = Pick<
  UserConsoleLog,
  'taskId' | 'taskName' | 'taskParentNames' | 'taskType' | 'testPath'
>;

export type WorkerContext = {
  /** Set by the node pool; browser runtimes do not have a node worker pool. */
  pool?: RstestPoolType;
  rootPath: RstestContext['rootPath'];
  projectRoot: ProjectContext['rootPath'];
  project: string;
  runtimeConfig: RuntimeConfig;
  taskId: number;
  /**
   * Monotonically increasing per-compile id: stable across all files of one
   * run, bumped on every watch rebuild. A change tells a reused worker to flush
   * its kept module cache before loading (#1373).
   */
  buildId: number;
  /** Byte budget for immutable assets and compilation data kept by vmThreads. */
  workerCacheLimit?: number;
  outputModule: boolean;
  testEnvironmentModule?: TestEnvironmentModuleReference;
  /** When true, the worker emits Perfetto trace events alongside phase totals. */
  trace?: boolean;
};

export type RunWorkerOptions = {
  options: {
    entryInfo: EntryInfo;
    setupEntries: EntryInfo[];
    /** All bundle assets needed by this task, including setup dependencies. */
    assetNames: string[];
    context: WorkerContext;
    /**
     * Identity of this task's test environment, derived host-side by
     * `getEnvironmentKey`. The pool reuses a worker only for matching keys
     * (see `pool/AGENTS.md`), and the worker compares it to detect a violation
     * of that guarantee — neither side re-derives it. Node-pool only: it sits
     * outside `context` because it is dispatch metadata, not worker state.
     */
    environmentKey: string;
    updateSnapshot: SnapshotUpdateState;
    type: 'run' | 'collect';
    /**
     * Eager assets for forks/threads when host memory permits. vmThreads
     * always pulls missing assets through getAssetsByEntry so its worker cache
     * can survive fresh VM Contexts without retaining module instances.
     */
    assets?: {
      assetFiles: AssetFiles;
      sourceMaps: Record<string, string>;
    };
  };
  rpcMethods: RuntimeRPC;
};

export type WorkerState = WorkerContext & {
  environment: string;
  testPath: TestPath;
  distPath: DistPath;
  currentTask?: CurrentTaskInfo;
  snapshotClient?: SnapshotClient;
  snapshotOptions: {
    updateSnapshot: SnapshotUpdateState;
    snapshotEnvironment: SnapshotEnvironment;
    snapshotFormat: RuntimeConfig['snapshotFormat'];
  };
};
