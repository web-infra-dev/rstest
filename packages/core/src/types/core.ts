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
  Test,
  TestCaseInfo,
  TestFileResult,
  TestResult,
} from './testSuite';

export type RstestCommand = 'watch' | 'run' | 'list';

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

export type RstestTestState = {
  getRunningModules: () => RunningModules;
  getTestModules: () => TestFileResult[];
  /** Get the test files paths. return `undefined` in watch mode. */
  getTestFiles: () => string[] | undefined;
};

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
};

export type ListCommandOptions = {
  filesOnly?: boolean;
  json?: boolean | string;
  includeSuites?: boolean;
  printLocation?: boolean;
};

export type ListCommandResult = {
  tests: Test[];
  testPath: string;
  project: string;
  errors?: FormattedError[];
};

export type RstestInstance = {
  context: RstestContext;
  runTests: () => Promise<void>;
  listTests: (options: ListCommandOptions) => Promise<ListCommandResult[]>;
};
