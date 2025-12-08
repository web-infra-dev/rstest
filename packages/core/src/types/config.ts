import type { RsbuildConfig } from '@rsbuild/core';
import type { SnapshotStateOptions } from '@vitest/snapshot';
import type { config } from 'chai';
import type { CoverageOptions, NormalizedCoverageOptions } from './coverage';
import type {
  BuiltInReporterNames,
  Reporter,
  ReporterWithOptions,
} from './reporter';

export type ChaiConfig = Partial<
  Omit<typeof config, 'useProxy' | 'proxyExcludedKeys' | 'deepEqual'>
>;

export type RstestPoolType = 'forks';

export type RstestPoolOptions = {
  /** Pool used to run tests in. */
  type?: RstestPoolType;
  /** Maximum number or percentage of workers to run tests in. */
  maxWorkers?: number | string;
  /** Minimum number or percentage of workers to run tests in. */
  minWorkers?: number | string;
  /** Pass additional arguments to node process in the child processes. */
  execArgv?: string[];
};

export type ProjectConfig = Omit<
  RstestConfig,
  | 'projects'
  | 'reporters'
  | 'pool'
  | 'isolate'
  | 'coverage'
  | 'resolveSnapshotPath'
  | 'onConsoleLog'
  | 'hideSkippedTests'
  | 'bail'
>;

type SnapshotFormat = Omit<
  NonNullable<SnapshotStateOptions['snapshotFormat']>,
  'plugins' | 'compareKeys'
>;

/**
 * A list of glob patterns or files that match your test projects.
 *
 * eg. ['packages/*', 'examples/node/rstest.config.ts']
 */
/**
 * Inline project config must include a name.
 */
type InlineProjectConfig = ProjectConfig & { name: string };
type TestProject = string | InlineProjectConfig;

export interface RstestConfig {
  /**
   * Project root
   *
   * @default process.cwd()
   */
  root?: string;
  /**
   * Run tests from one or more projects.
   */
  projects?: TestProject[];
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
  exclude?:
    | string[]
    | {
        patterns: string[];
        /**
         * override default exclude patterns
         * @default false
         */
        override?: boolean;
      };
  /**
   * A list of glob patterns that match your in-source test files
   *
   * @default []
   */
  includeSource?: string[];
  /**
   * Path to setup files. They will be run before each test file.
   */
  setupFiles?: string[] | string;

  /**
   * Retry the test specific number of times if it fails.
   * @default 0
   */
  retry?: number;
  /**
   * Pass when no tests are found.
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
   * The environment that will be used for testing
   *
   * @default 'node'
   */
  testEnvironment?: 'node' | 'jsdom' | 'happy-dom';

  /**
   * Stop running tests after n failures.
   * Set to 0 to run all tests regardless of failures.
   *
   * @default 0
   */
  bail?: number;

  /**
   * print console traces when calling any console method.
   *
   * @default false
   */
  printConsoleTrace?: boolean;

  /**
   * Disable console intercept. `onConsoleLog` & `printConsoleTrace` configuration will not take effect.
   *
   * @default false
   */
  disableConsoleIntercept?: boolean;

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
    | (
        | Reporter
        | BuiltInReporterNames
        | [BuiltInReporterNames]
        | ReporterWithOptions
      )[];
  /**
   * Hide skipped tests logs.
   *
   * @default false
   */
  hideSkippedTests?: boolean;
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
   * Timeout of hook in milliseconds.
   * @default 10000
   */
  hookTimeout?: number;

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
   * The number of milliseconds after which a test or suite is considered slow and reported as such in the results.
   * @default 300
   */
  slowTestThreshold?: number;

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

  /**
   * Maximum number of concurrent tests
   * @default 5
   */
  maxConcurrency?: number;

  /**
   * Log heap usage after each test
   * @default false
   */
  logHeapUsage?: boolean;

  /**
   * Custom handler for console log in tests
   */
  onConsoleLog?: (content: string) => boolean | void;

  /** Format snapshot output */
  snapshotFormat?: SnapshotFormat;

  /**
   * Resolve custom snapshot path
   */
  resolveSnapshotPath?: (testPath: string, snapExtension: string) => string;

  /**
   * Custom environment variables available on `process.env` during tests.
   */
  env?: Partial<NodeJS.ProcessEnv>;

  /**
   * Coverage options
   */
  coverage?: CoverageOptions;

  /**
   * chai configuration options
   */
  chaiConfig?: ChaiConfig;

  // Rsbuild configs

  plugins?: RsbuildConfig['plugins'];

  source?: Pick<
    NonNullable<RsbuildConfig['source']>,
    'define' | 'tsconfigPath' | 'decorators' | 'include' | 'exclude'
  >;

  performance?: Pick<
    NonNullable<RsbuildConfig['performance']>,
    'bundleAnalyze'
  >;

  dev?: Pick<NonNullable<RsbuildConfig['dev']>, 'writeToDisk'>;

  output?: Pick<
    NonNullable<RsbuildConfig['output']>,
    'cssModules' | 'externals' | 'cleanDistPath' | 'module'
  >;

  resolve?: RsbuildConfig['resolve'];

  tools?: Pick<
    NonNullable<RsbuildConfig['tools']>,
    'rspack' | 'swc' | 'bundlerChain'
  >;
}

type OptionalKeys =
  | 'testNamePattern'
  | 'plugins'
  | 'source'
  | 'resolve'
  | 'output'
  | 'performance'
  | 'tools'
  | 'dev'
  | 'onConsoleLog'
  | 'chaiConfig'
  | 'resolveSnapshotPath';

export type NormalizedConfig = Required<
  Omit<
    RstestConfig,
    OptionalKeys | 'pool' | 'projects' | 'coverage' | 'setupFiles' | 'exclude'
  >
> & {
  [key in OptionalKeys]?: RstestConfig[key];
} & {
  pool: RstestPoolOptions;
  coverage: NormalizedCoverageOptions;
  setupFiles: string[];
  exclude: {
    patterns: string[];
    override?: boolean;
  };
};

export type NormalizedProjectConfig = Required<
  Omit<
    NormalizedConfig,
    OptionalKeys | 'projects' | 'reporters' | 'pool' | 'setupFiles'
  >
> & {
  [key in OptionalKeys]?: NormalizedConfig[key];
} & {
  setupFiles: string[];
};
