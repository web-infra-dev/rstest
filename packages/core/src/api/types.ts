import type {
  CoverageMapData,
  FileFilterMode,
  FormattedError,
  Location as TestLocation,
  NormalizedConfig,
  RstestConfig,
  SnapshotSummary,
  TaskMeta,
  TestResultStatus,
} from '../types';
import type { LoadedRstestConfig } from '../config';

/** @experimental Subject to change until 1.0.0. */
export type {
  CoverageMapData,
  FileFilterMode,
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
  filterMode?: FileFilterMode;
  related?: boolean;
  changed?: boolean | string;
  shard?: string | { index: number; count: number };
  project?: string[];
  testNamePattern?: RegExp | string;
  update?: boolean;
  bail?: number | boolean;
  passWithNoTests?: boolean;
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
  includeLocation?: boolean;
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
