import type { BuiltInReporterNames, Reporter } from './reporter';

export type RstestPoolType = 'forks';

export type RstestPoolOptions = {
  /** Pool used to run tests in. */
  type: RstestPoolType;
  /** Maximum number or percentage of workers to run tests in. */
  maxWorkers?: number | string;
  /** Minimum number or percentage of workers to run tests in. */
  minWorkers?: number | string;
  /** Pass additional arguments to node process in the child processes. */
  execArgv?: string[];
};

export interface RstestConfig {
  /**
   * Project root
   *
   * @default process.cwd()
   */
  root?: string;
  /**
   * Project name
   *
   * @default rstest
   */
  name?: string;
  /**
   * A list of glob patterns that match your test files.
   *
   * @default ['**\/*.{test,spec}.?(c|m)[jt]s?(x)']
   */
  include?: string[];
  /**
   * A list of glob patterns that should be excluded from your test files.
   *
   * @default ['**\/node_modules/**', '**\/dist/**']
   */
  exclude?: string[];
  /**
   * Path to setup files. They will be run before each test file.
   */
  setupFiles?: string[] | string;
  /**
   * Allows the test suite to pass when no files are found.
   *
   * @default false
   */
  passWithNoTests?: boolean;
  /**
   * Pool used to run tests in.
   */
  pool?: RstestPoolType | RstestPoolOptions;
  /**
   * Run tests in an isolated environment
   *
   * @default true
   */
  isolate?: boolean;
  /**
   * Provide global APIs
   *
   * @default false
   */
  globals?: boolean;
  /**
   * Update snapshot files. Will update all changed snapshots and delete obsolete ones.
   *
   * @default false
   */
  update?: boolean;
  /**
   * Custom reporter for output.
   * @default ['default']
   */
  reporters?:
    | Reporter
    | BuiltInReporterNames
    | (Reporter | BuiltInReporterNames)[];
  /**
   * Run only tests with a name that matches the regex.
   */
  testNamePattern?: string | RegExp;

  /**
   * Timeout of a test in milliseconds.
   * @default 5000
   */
  testTimeout?: number;

  /**
   * Automatically clear mock calls, instances, contexts and results before every test.
   * @default false
   */
  clearMocks?: boolean;
  /**
   * Automatically reset mock state before every test.
   * @default false
   */
  resetMocks?: boolean;
  /**
   * Automatically restore mock state and implementation before every test.
   * @default false
   */
  restoreMocks?: boolean;
  /**
   * Restores all global variables that were changed with `rstest.stubGlobal` before every test.
   * @default false
   */
  unstubGlobals?: boolean;
  /**
   * Restores all `process.env` values that were changed with `rstest.stubEnv` before every test.
   * @default false
   */
  unstubEnvs?: boolean;
}

export type NormalizedConfig = Required<
  Omit<RstestConfig, 'pool' | 'setupFiles' | 'testNamePattern'>
> & {
  pool: RstestPoolOptions;
  setupFiles?: string[] | string;
  testNamePattern?: RstestConfig['testNamePattern'];
};
