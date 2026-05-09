import type { SnapshotManager } from '@vitest/snapshot/manager';
import type { TestStateManager } from '../core/stateManager';
import type {
  NormalizedConfig,
  NormalizedProjectConfig,
  RstestConfig,
} from './config';
import type { Reporter } from './reporter';
import type {
  FormattedError,
  TestCaseInfo,
  TestFileResult,
  TestInfo,
  TestResult,
} from './testSuite';

/**
 * @internal
 */
export type ProjectEntries = {
  entries: Record<string, string>;
  fileFilters?: string[];
};

export type RstestCommand = 'watch' | 'run' | 'list' | 'merge-reports';
/**
 * @internal
 */
export type FileFilterMode = 'fuzzy' | 'exact';

/**
 * @internal
 */
export type Project = { config: RstestConfig; configFilePath?: string };

export type ProjectContext = {
  name: string;
  environmentName: string;
  /** The root path of current project. */
  rootPath: string;
  /** Whether to output es module. */
  outputModule: boolean;
  configFilePath?: string;
  normalizedConfig: NormalizedProjectConfig;
  _globalSetups: boolean;
};

type RunningModules = Map<
  string,
  {
    runningTests: TestCaseInfo[];
    results: TestResult[];
  }
>;

/**
 * @internal
 */
export type RstestTestState = {
  getRunningModules: () => RunningModules;
  getTestModules: () => TestFileResult[];
  /** Get the test files paths. return `undefined` in watch mode. */
  getTestFiles: () => string[] | undefined;
};

/**
 * @internal
 */
export type RstestContext = {
  /** The Rstest core version. */
  version: string;
  /** The root path of rstest. */
  rootPath: string;
  /** The original Rstest config passed from the createRstest method. */
  originalConfig: Readonly<RstestConfig>;
  /** The normalized Rstest config. */
  normalizedConfig: NormalizedConfig;
  /** filter by a filename regex pattern */
  fileFilters?: string[];
  /** How file filters should match discovered test files. */
  fileFilterMode?: FileFilterMode;
  /** Original source filters passed to `--related` / `--findRelatedTests`. */
  relatedFilters?: string[];
  /** `--related` resolved successfully but matched no test files. */
  relatedResolutionEmpty?: boolean;
  /** The config file path. */
  configFilePath?: string;
  /**
   * Run tests from one or more projects.
   */
  projects: ProjectContext[];

  /**
   * The test state
   */
  testState: RstestTestState;
  /**
   * The command type.
   *
   * - run: `rstest`
   * - dev: `rstest dev` or watch mode
   * - list: `rstest list`
   */
  command: RstestCommand;
  reporters: Reporter[];
  snapshotManager: SnapshotManager;
  stateManager: TestStateManager;
  reporterResults: {
    results: TestFileResult[];
    testResults: TestResult[];
  };
};

/**
 * @internal
 */
export type ListCommandOptions = {
  filesOnly?: boolean;
  json?: boolean | string;
  includeSuites?: boolean;
  printLocation?: boolean;
  summary?: boolean;
};

export type ListCommandResult = {
  tests: TestInfo[];
  testPath: string;
  project: string;
  errors?: FormattedError[];
};

/**
 * @internal
 */
export type RstestInstance = {
  context: RstestContext;
  runTests: () => Promise<void>;
  listTests: (options: ListCommandOptions) => Promise<ListCommandResult[]>;
  mergeReports: (options?: {
    path?: string;
    cleanup?: boolean;
  }) => Promise<void>;
};
