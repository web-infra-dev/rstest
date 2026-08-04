import type { SnapshotManager } from '@vitest/snapshot/manager';
import type { TestStateManager } from '../core/stateManager';
import type { RunExitCode } from '../core/exitCode';
import type { EnvChanges } from '../utils/env';
import type {
  EnvironmentName,
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

export type ProjectEntries = {
  entries: Record<string, string>;
  fileFilters?: string[];
};

export type RstestCommand = 'watch' | 'run' | 'list' | 'merge-reports';
export type FileFilterMode = 'fuzzy' | 'exact';

export type Project = { config: RstestConfig; configFilePath?: string };

export type ProjectContext = {
  name: string;
  environmentName: string;
  _environmentGroup?: {
    key: string;
    baseKey: string;
    baseTestEnvironment: NormalizedProjectConfig['testEnvironment'];
    sourceEnvironmentName: string;
    sourceProjectName: string;
    hasImplicitEntries?: boolean;
    environmentComment?: {
      name?: EnvironmentName;
      options?: Record<string, unknown>;
    };
  };
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
  /** How file filters should match discovered test files. */
  fileFilterMode?: FileFilterMode;
  /** Original source filters passed to `--related`, `--findRelatedTests`, or resolved from `--changed`. */
  relatedFilters?: string[];
  /** CLI option that produced related source filters. */
  relatedMode?: 'related' | 'changed';
  /** Related test resolution completed successfully but matched no test files. */
  relatedResolutionEmpty?: boolean;
  /** Changed source files used to limit coverage reports for `--changed`. */
  changedCoverageFilters?: string[];
  /** Why a related run was expanded back to the full test suite. */
  relatedRerunReason?: 'forceRerunTrigger';
  /** Changed files that caused a related run to expand back to the full test suite. */
  relatedRerunFiles?: string[];
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
  /**
   * Dump a Perfetto-compatible performance trace JSON file. CLI-only switch;
   * not exposed via user config.
   *
   * @internal
   */
  trace: boolean;
  /**
   * True when running inside a programmatic host (via `@rstest/core/api`)
   * rather than the CLI: the caller owns the process, so Rstest installs no
   * signal handlers and never calls `process.exit`.
   *
   * @internal
   */
  embedded: boolean;
  /**
   * This run's exit code. Every layer that would otherwise write
   * `process.exitCode` raises here; only the CLI mirrors it onto the process.
   */
  exitCode: RunExitCode;
  /**
   * Env change-set this run's `globalSetup`s produced, merged in the order they
   * ran (`undefined` marks a key the setup deleted). Every child of this run
   * composes it into its env via `composeWorkerEnv`; the host `process.env` is
   * never mutated, so concurrent in-process runs keep separate change-sets.
   */
  workerEnv: EnvChanges;
  reporters: Reporter[];
  snapshotManager: SnapshotManager;
  stateManager: TestStateManager;
  reporterResults: {
    results: TestFileResult[];
    testResults: TestResult[];
  };
  /** Merge a batch of file/test results into `reporterResults`. */
  updateReporterResultState: (
    results: TestFileResult[],
    testResults: TestResult[],
    deletedEntries?: string[],
  ) => void;
};

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
 * Handle returned by `runTests()` when it runs in `watch` mode: watch keeps the
 * Rsbuild dev server and worker pool alive re-running tests on file changes, so
 * a programmatic caller needs an explicit teardown. `close()` stops watching and
 * releases the pool + dev server. Absent for one-shot (`run`) runs.
 */
export type RstestWatchHandle = {
  close: () => Promise<void>;
};

/** What one build of the reusable runner (`src/core/testRunner.ts`) produced. */
export type RunnerBuildOutput = {
  /** Absolute paths of the test files compiled into this build. */
  testFiles: string[];
};

/**
 * Selection and control for one cycle of the reusable runner. Every field is
 * applied to the live config/snapshot state for that cycle only and restored
 * afterwards, so it never leaks into the next one. `filters` resolves against
 * the built set — it can narrow it, never widen it.
 */
export type RunnerCycleOptions = {
  /**
   * Narrows within the built set, matched per `filterMode`. It can only narrow:
   * a filter matching no compiled test file runs nothing rather than widening
   * the build.
   */
  filters?: string[];

  /**
   * Matching strategy for `filters`: `'fuzzy'` (default; case-insensitive
   * substring) or `'exact'` (normalized path equality).
   */
  filterMode?: FileFilterMode;

  /** Run only tests whose full name matches (string coerced via `new RegExp`). */
  testNamePattern?: RegExp | string;

  /** Update outdated snapshots. */
  update?: boolean;

  /** Stop the run after N failing tests (`0`/`false` = run all). */
  bail?: number | boolean;

  /** Treat a run that matched no files as pass instead of failure. */
  passWithNoTests?: boolean;
};

/**
 * Core-side build-once/run-many driver over the non-watch pipeline. Owns the
 * dev server, the worker pool and `globalSetup` for its whole lifetime; the
 * host turns a cycle into a public result by reading that cycle's
 * `context.exitCode`, which the driver resets per cycle. `runCycle` resolves
 * for a failing run and rejects only when the run could not be driven at all (a
 * failed implicit build included).
 */
export type CoreTestRunner = {
  build: () => Promise<RunnerBuildOutput>;
  runCycle: (options?: RunnerCycleOptions) => Promise<void>;
  close: () => Promise<void>;
};

/**
 * Internal runner returned by the sync `createRstestContext` factory: a context
 * bound to one command + filter set, plus the side-effecting drive methods. The
 * public, async, instance-shaped API (`run`/`listTests`/`close`) lives in
 * `@rstest/core/api` and is built on top of this.
 */
export type ResolvedRstest = {
  context: RstestContext;
  /**
   * Drive the run. Resolves to an {@link RstestWatchHandle} in `watch` mode (the
   * dev server keeps running after this resolves), or `void` for one-shot runs.
   */
  runTests: () => Promise<void | RstestWatchHandle>;
  /**
   * Build once, run many: the same non-watch pipeline `runTests` drives, with
   * the compile and the run cycle split so the built test set can be executed
   * repeatedly. Node projects only.
   */
  createTestRunner: () => Promise<CoreTestRunner>;
  listTests: (options: ListCommandOptions) => Promise<ListCommandResult[]>;
  mergeReports: (options?: {
    path?: string;
    cleanup?: boolean;
  }) => Promise<void>;
};
