import type {
  CoverageMapData,
  FileFilterMode,
  Location,
  ResolvedRstestConfig,
  RunnerCycleOptions,
  RstestConfig,
  SnapshotSummary,
  TaskMeta,
  TestResultStatus,
} from '../types';

/** @experimental Subject to change until 1.0.0. */
export type { Reporter, TestResultStatus } from '../types';

/** @experimental Subject to change until 1.0.0. */
export type RstestUserConfig = RstestConfig;

/** @experimental Subject to change until 1.0.0. */
export type RstestConfigFn = () => RstestConfig | Promise<RstestConfig>;

/** @experimental Subject to change until 1.0.0. */
export interface CreateRstestOptions {
  /** Working directory. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Inline configuration or a zero-argument configuration factory. */
  config?: RstestConfig | RstestConfigFn;
}

/** @experimental Subject to change until 1.0.0. */
export interface RstestProjectSummary {
  name: string;
  root: string;
  configFilePath?: string;
}

/** @experimental Subject to change until 1.0.0. */
export interface RstestInstanceContext {
  readonly version: string;
  readonly root: string;
  readonly config: Readonly<ResolvedRstestConfig>;
  readonly projects: readonly RstestProjectSummary[];
}

/** @experimental Subject to change until 1.0.0. */
export interface CreateRunnerOptions {
  filters?: string[];
  filterMode?: FileFilterMode;
  related?: boolean;
  changed?: boolean | string;
  shard?: string | { index: number; count: number };
  project?: string[];
}

/** @experimental Subject to change until 1.0.0. */
export type RunnerRunOptions = RunnerCycleOptions;

/** @experimental Subject to change until 1.0.0. */
export interface RunOptions extends CreateRunnerOptions, RunnerCycleOptions {}

/** @experimental Subject to change until 1.0.0. */
export interface RunnerBuildResult {
  testFiles: string[];
}

/** @experimental Subject to change until 1.0.0. */
export interface RstestRunner {
  build(): Promise<RunnerBuildResult>;
  run(options?: RunnerRunOptions): Promise<TestRunResult>;
  close(): Promise<void>;
}

/** @experimental Subject to change until 1.0.0. */
export interface WatchOptions {
  onResult?: (result: TestRunResult) => void;
}

/** @experimental Subject to change until 1.0.0. */
export interface RstestWatcher {
  close(): Promise<void>;
}

/** @experimental Subject to change until 1.0.0. */
export type RstestWatchHandle = RstestWatcher;

/** @experimental Subject to change until 1.0.0. */
export interface ListOptions {
  filesOnly?: boolean;
  includeSuites?: boolean;
  printLocation?: boolean;
}

/** @experimental Subject to change until 1.0.0. */
export interface ListedTest {
  file: string;
  name?: string;
  taskName?: string;
  parentNames?: string[];
  project?: string;
  location?: Location;
  runMode?: 'skip' | 'todo';
  type: 'file' | 'suite' | 'case';
}

/** @experimental Subject to change until 1.0.0. */
export interface MergeReportsOptions {
  path?: string;
  cleanup?: boolean;
}

/** @experimental Subject to change until 1.0.0. */
export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
  diff?: string;
  actual?: string;
  expected?: string;
  retryCount?: number;
  cause?: SerializedError;
}

/** @experimental Subject to change until 1.0.0. */
export interface TestResult {
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
export interface TestFileResult extends TestResult {
  results: TestResult[];
}

/** @experimental Subject to change until 1.0.0. */
export interface TestRunResult {
  ok: boolean;
  files: TestFileResult[];
  stats: {
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
  context: RstestInstanceContext;
  run(options?: RunOptions): Promise<TestRunResult>;
  createRunner(options?: CreateRunnerOptions): Promise<RstestRunner>;
  watch(options?: WatchOptions & RunOptions): Promise<RstestWatcher>;
  listTests(options?: ListOptions & RunOptions): Promise<ListedTest[]>;
  mergeReports(options?: MergeReportsOptions): Promise<TestRunResult>;
}
