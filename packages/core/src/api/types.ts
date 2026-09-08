import type { LoadConfigOptions } from '@rsbuild/core';
import type {
  BrowserName,
  CoverageMapData,
  FormattedError,
  Location as TestLocation,
  NormalizedConfig,
  RstestConfig,
  RstestOutputConfig,
  SnapshotSummary,
  TaskMeta,
  TestResultStatus,
} from '../types';
import type { LoadedRstestConfig } from '../config';

/** @experimental Subject to change until 1.0.0. */
export type {
  CoverageMapData,
  NormalizedConfig,
  RstestConfig,
  SnapshotSummary,
  TaskMeta,
  TestLocation,
  TestResultStatus,
  LoadedRstestConfig,
};

/** @experimental Subject to change until 1.0.0. */
export interface CreateRstestOptions {
  /** Working directory. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Inline or loaded configuration. */
  config?: RstestConfig | LoadedRstestConfig;
  /** The loader used for config files discovered through `projects`; defaults to `auto`. */
  configLoader?: LoadConfigOptions['loader'];
}

/** @experimental Subject to change until 1.0.0. */
export interface ProjectContext {
  name: string;
  rootPath: string;
  configFilePath?: string;
}

/** @experimental Subject to change until 1.0.0. */
export interface RstestContext {
  readonly version: string;
  readonly rootPath: string;
  readonly config: Readonly<NormalizedConfig>;
  /** Resolved projects, including the implicit default project. */
  readonly projects: readonly ProjectContext[];
}

/** @experimental Subject to change until 1.0.0. */
export interface RunOptions {
  filters?: string[];
  related?: boolean;
  changed?: boolean | string;
  shard?: string;
  project?: string[];
  testNamePattern?: RegExp | string;
  update?: boolean;
  bail?: number | boolean;
  passWithNoTests?: boolean;

  // Config overrides: see the config option of the same name.
  // file selection
  include?: string[];
  exclude?: string[];
  // runtime environment
  globals?: boolean;
  testEnvironment?: string;
  browser?:
    | boolean
    | {
        enabled?: boolean;
        name?: BrowserName;
        headless?: boolean;
        port?: number;
        strictPort?: boolean;
        providerOptions?: Record<string, unknown>;
      };
  federation?: boolean;
  // timeouts / retries / concurrency
  testTimeout?: number;
  hookTimeout?: number;
  retry?: number;
  maxConcurrency?: number;
  slowTestThreshold?: number;
  // mock lifecycle
  clearMocks?: boolean;
  resetMocks?: boolean;
  restoreMocks?: boolean;
  unstubGlobals?: boolean;
  unstubEnvs?: boolean;
  // output / diagnostics
  silent?: boolean | 'passed-only';
  printConsoleTrace?: boolean;
  disableConsoleIntercept?: boolean;
  logHeapUsage?: boolean;
  detectAsyncLeaks?: boolean;
  hideSkippedTests?: boolean;
  hideSkippedTestFiles?: boolean;
  includeTaskLocation?: boolean;
  reporters?: string | string[];
  onlyFailures?: boolean;
  // build
  source?: { tsconfigPath?: string };
  dev?: { writeToDisk?: boolean };
  output?: Pick<RstestOutputConfig, 'emitAssets' | 'cleanDistPath' | 'module'>;
  // root-only (applied to the root config; the engine forwards isolate and coverage to every project)
  pool?:
    | string
    | {
        type?: string;
        maxWorkers?: string | number;
        execArgv?: string[] | string;
      };
  isolate?: boolean;
  coverage?:
    | boolean
    | {
        enabled?: boolean | string;
        allowExternal?: boolean;
        provider?: 'istanbul' | 'v8';
        include?: string | string[];
        changed?: boolean | string;
        exclude?: string | string[];
        reporters?: string | string[];
        reportsDirectory?: string;
        reportOnFailure?: boolean | string;
        clean?: boolean | string;
      };
}

/** @experimental Subject to change until 1.0.0. */
export interface WatchOptions {
  onResult?: (result: TestRunResult) => void;
}

/** @experimental Subject to change until 1.0.0. */
export interface RstestWatcher {
  /**
   * Closes the watch session. Idempotent: repeated calls observe the same
   * result. Rejects if `globalSetup` teardown fails.
   */
  close(): Promise<void>;
}

/** @experimental Subject to change until 1.0.0. */
export interface ListOptions {
  filesOnly?: boolean;
  includeSuites?: boolean;
}

/** @experimental Subject to change until 1.0.0. */
export interface ListedTest {
  testPath: string;
  name?: string;
  fullName?: string;
  parentNames?: string[];
  project: string;
  location?: TestLocation;
  runMode?: 'skip' | 'todo';
  type: 'file' | 'suite' | 'case';
}

/** @experimental Subject to change until 1.0.0. */
export interface MergeReportsOptions {
  path?: string;
  cleanup?: boolean;
}

/** @experimental Subject to change until 1.0.0. */
export interface SerializedError extends Pick<
  FormattedError,
  'message' | 'stack' | 'diff' | 'actual' | 'expected' | 'retryCount'
> {
  name: string;
  cause?: SerializedError;
}

/** @experimental Subject to change until 1.0.0. */
export interface TestCaseResult {
  status: TestResultStatus;
  name: string;
  testPath: string;
  parentNames?: string[];
  duration?: number;
  errors?: SerializedError[];
  retryErrors?: SerializedError[];
  retryCount?: number;
  project: string;
  meta?: TaskMeta;
}

/** @experimental Subject to change until 1.0.0. */
export interface TestFileRunResult extends TestCaseResult {
  tests: TestCaseResult[];
}

// Status literals match TestResultStatus; summary count keys stay past tense.
/** @experimental Subject to change until 1.0.0. */
export type TestRunStatus = 'pass' | 'fail' | 'error';

/** @experimental Subject to change until 1.0.0. */
export interface TestRunResult {
  /** Overall status of the run. */
  status: TestRunStatus;
  files: TestFileRunResult[];
  /** Counts for this cycle, grouped by tests and files. */
  summary: {
    tests: {
      total: number;
      passed: number;
      failed: number;
      skipped: number;
      todo: number;
    };
    files: {
      total: number;
      failed: number;
    };
  };
  unhandledErrors: SerializedError[];
  duration: { total: number };
  snapshot?: SnapshotSummary;
  coverage?: CoverageMapData;
}

/** @experimental Subject to change until 1.0.0. */
export interface RstestInstance {
  readonly context: RstestContext;
  run(options?: RunOptions): Promise<TestRunResult>;
  watch(options?: WatchOptions & RunOptions): Promise<RstestWatcher>;
  /**
   * Returns declarations in depth-first declaration order. A suite immediately
   * precedes its descendants, and all entries from one file stay contiguous.
   */
  listTests(options?: ListOptions & RunOptions): Promise<ListedTest[]>;
  mergeReports(options?: MergeReportsOptions): Promise<TestRunResult>;
}
