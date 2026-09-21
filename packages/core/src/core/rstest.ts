import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { SnapshotManager } from '@vitest/snapshot/manager';
import { join } from 'pathe';
import { isCI } from 'std-env';
import { withDefaultConfig } from '../config';
import { DefaultReporter, exitReporters } from '../reporter';
import { BlobReporter } from '../reporter/blob';
import { DotReporter } from '../reporter/dot';
import { GithubActionsReporter } from '../reporter/githubActions';
import { JsonReporter } from '../reporter/json';
import { JUnitReporter } from '../reporter/junit';
import { MdReporter } from '../reporter/md';
import { VerboseReporter } from '../reporter/verbose';
import { reporterFileKey } from '../reporter/utils';
import type {
  BuiltInReporterNames,
  InternalContext,
  InternalProjectContext,
  NormalizedConfig,
  NormalizedProjectConfig,
  Project,
  Reporter,
  ReporterContext,
  RstestCommand,
  RstestConfig,
  RstestTestState,
  TestFileResult,
  TestResult,
} from '../types';
import type { PackageInstallerConfirm } from '../utils/packageInstaller';
import {
  castArray,
  DEFAULT_BROWSER_EXPECT_POLL_TIMEOUT,
  DEFAULT_BROWSER_TEST_TIMEOUT,
  ENV,
  getAbsolutePath,
  normalizeBuildCache,
  resolveBuildCacheDependencyPaths,
  TS_CONFIG_FILE,
} from '../utils';
import { createExitCode, type RstestExitCode } from './exitCode';
import { TestStateManager } from './stateManager';

/**
 * Only letters, numbers, "-", "_", and "$" are allowed.
 */
function formatEnvironmentName(name: string): string {
  return name.replace(/[^a-zA-Z0-9\-_$]/g, '_');
}

type OutputModuleConfig = {
  federation: boolean;
  output?: {
    module?: boolean;
  };
};

const resolveOutputModule = (config: OutputModuleConfig): boolean =>
  config.federation
    ? false
    : (config.output?.module ?? process.env[ENV.OUTPUT_MODULE] !== 'false');

const applyBrowserDefaults = <
  Config extends Pick<NormalizedConfig, 'browser' | 'testTimeout' | 'expect'>,
>(
  config: Config,
  userConfig: RstestConfig,
): Config => {
  if (!config.browser.enabled) {
    return config;
  }
  if (userConfig.testTimeout === undefined) {
    config.testTimeout = DEFAULT_BROWSER_TEST_TIMEOUT;
  }
  if (userConfig.expect?.poll?.timeout === undefined) {
    config.expect.poll.timeout = DEFAULT_BROWSER_EXPECT_POLL_TIMEOUT;
  }
  return config;
};

type Options = {
  cwd: string;
  command: RstestCommand;
  fileFilters?: string[];
  configFilePath?: string;
  configFileDependencies?: string[];
  projects: Project[];
  trace?: boolean;
  /** See the `embedded` option on `createRstest`. */
  embedded?: boolean;
  initializeReporters?: boolean;
};

export class Rstest implements InternalContext {
  public cwd: string;
  public command: RstestCommand;
  public fileFilters?: string[];
  public relatedFilters?: string[];
  public relatedMode?: 'related' | 'changed';
  public relatedResolutionEmpty?: boolean;
  public changedCoverageFilters?: string[];
  public relatedRerunReason?: 'forceRerunTrigger';
  public relatedRerunFiles?: string[];
  public configFilePath?: string;
  public configFileDependencies: string[];
  public embedded: boolean;
  public exitCode: RstestExitCode = createExitCode();
  public workerEnv: Record<string, string | undefined> = {};
  public globalTeardownCallbacks: Array<
    () => boolean | void | Promise<boolean | void>
  > = [];
  public packageInstallerConfirm?: PackageInstallerConfirm;
  public closeWatchSession?: () => Promise<void>;
  public onFatalWatchFailure?: (error: Error) => void;
  public reporters: Reporter[] = [];
  public snapshotManager: SnapshotManager;
  public trace: boolean;
  public version: string;
  public rootPath: string;
  public originalConfig: RstestConfig;
  public normalizedConfig: NormalizedConfig;
  public reporterResults: {
    results: TestFileResult[];
    testResults: TestResult[];
  } = {
    results: [],
    testResults: [],
  };
  private reporterResultIndex = new Map<string, number>();
  private reportersInitialized = false;
  public stateManager: TestStateManager = new TestStateManager();

  public testState: RstestTestState = {
    getRunningModules: () => this.stateManager.runningModules,
    getTestModules: () => this.stateManager.testModules,
    getTestFiles: () => {
      // TODO: support collecting test files in watch mode
      if (this.command === 'watch') {
        return undefined;
      }
      return this.stateManager.testFiles;
    },
  };

  public projects: InternalProjectContext[] = [];

  public constructor(
    {
      cwd = process.cwd(),
      command,
      fileFilters,
      configFilePath,
      configFileDependencies = [],
      projects,
      trace = false,
      embedded = false,
      initializeReporters = true,
    }: Options,
    userConfig: RstestConfig,
  ) {
    this.cwd = cwd;
    this.command = command;
    this.trace = trace;
    this.fileFilters = fileFilters;
    this.configFilePath = configFilePath;
    this.configFileDependencies = configFileDependencies;
    this.embedded = embedded;

    const rootPath = userConfig.root
      ? getAbsolutePath(cwd, userConfig.root)
      : cwd;

    const rstestConfig = applyBrowserDefaults(
      withDefaultConfig(
        resolveBuildCacheDependencyPaths(
          {
            ...userConfig,
            root: rootPath,
          },
          configFilePath,
        ),
      ),
      userConfig,
    );

    if (command === 'watch' && rstestConfig.shard) {
      throw new Error('Test sharding is not supported in watch mode.');
    }

    const snapshotManager = new SnapshotManager({
      updateSnapshot: rstestConfig.update ? 'all' : isCI ? 'none' : 'new',
    });

    this.snapshotManager = snapshotManager;
    this.version = RSTEST_VERSION;
    this.rootPath = rootPath;
    this.originalConfig = userConfig;
    this.normalizedConfig = rstestConfig;
    this.projects = projects.length
      ? projects.map((project) => {
          project.config.root = getAbsolutePath(rootPath, project.config.root!);

          // TODO: support extend projects config
          const projectUserConfig = resolveBuildCacheDependencyPaths(
            project.config,
            project.configFilePath ?? configFilePath,
          );
          const config = applyBrowserDefaults(
            withDefaultConfig(projectUserConfig) as NormalizedProjectConfig,
            projectUserConfig,
          );
          // some configs are global only
          config.isolate = rstestConfig.isolate;
          config.coverage = rstestConfig.coverage;
          config.bail = rstestConfig.bail;
          // `resolveSnapshotPath` and `onConsoleLog` are omitted from
          // ProjectConfig (root-only), so they must be copied down; otherwise the
          // per-project event pump reads `undefined` and silently drops the root
          // behavior in multi-project mode (default snapshot paths / unfiltered
          // console), diverging from the browser host which reads root config.
          config.resolveSnapshotPath = rstestConfig.resolveSnapshotPath;
          config.onConsoleLog = rstestConfig.onConsoleLog;

          config.source ??= {};
          if (!config.source.tsconfigPath) {
            const tsconfigPath = join(config.root, TS_CONFIG_FILE);

            if (existsSync(tsconfigPath)) {
              config.source.tsconfigPath = tsconfigPath;
            }
          } else {
            config.source.tsconfigPath = getAbsolutePath(
              config.root,
              config.source.tsconfigPath,
            );
          }
          const environmentName = formatEnvironmentName(config.name);

          if (config.performance?.buildCache) {
            config.performance.buildCache = normalizeBuildCache({
              buildCache: config.performance.buildCache,
              root: config.root,
              tsconfigPaths: config.source?.tsconfigPath
                ? [config.source.tsconfigPath]
                : [],
              outputDistPathRoot: rstestConfig.output.distPath.root,
              environmentName,
              browserEnabled: config.browser.enabled,
              coverageEnabled: config.coverage?.enabled,
              coverageProvider: config.coverage?.provider,
              assumeNormalized: true,
            });
          }

          return {
            configFilePath: project.configFilePath,
            configFileDependencies: project.configFileDependencies,
            rootPath: config.root,
            name: config.name,
            _globalSetups: false,
            outputModule: resolveOutputModule(config),
            environmentName,
            normalizedConfig: config,
          };
        })
      : [
          {
            configFilePath,
            configFileDependencies,
            rootPath,
            _globalSetups: false,
            name: rstestConfig.name,
            outputModule: resolveOutputModule(rstestConfig),
            environmentName: formatEnvironmentName(rstestConfig.name),
            normalizedConfig: rstestConfig,
          },
        ];

    this.reportersInitialized = !initializeReporters || command === 'list';
  }

  public async initializeReporters(): Promise<void> {
    if (this.reportersInitialized) {
      return;
    }
    this.reportersInitialized = true;
    this.reporters = await createReporters(this);
  }

  public updateReporterResultState(
    results: TestFileResult[],
    testResults: TestResult[],
    deletedEntries: string[] = [],
  ): void {
    const filesToUpdate = new Map<string, Set<string>>();
    results.forEach((item) => {
      const key = reporterFileKey(item.project, item.testPath);
      const projectPaths = filesToUpdate.get(item.project);
      if (projectPaths) {
        projectPaths.add(item.testPath);
      } else {
        filesToUpdate.set(item.project, new Set([item.testPath]));
      }
      const existingIndex = this.reporterResultIndex.get(key);
      if (existingIndex !== undefined) {
        this.reporterResults.results[existingIndex] = item;
      } else {
        this.reporterResultIndex.set(key, this.reporterResults.results.length);
        this.reporterResults.results.push(item);
      }
    });

    this.reporterResults.testResults = this.reporterResults.testResults.filter(
      (result) => !filesToUpdate.get(result.project)?.has(result.testPath),
    );
    this.reporterResults.testResults.push(...testResults);

    // Remove deleted entries
    if (deletedEntries.length > 0) {
      const deletedPathsSet = new Set(deletedEntries);
      this.reporterResults.results = this.reporterResults.results.filter(
        (r) => !deletedPathsSet.has(r.testPath),
      );
      this.reporterResults.testResults =
        this.reporterResults.testResults.filter(
          (r) => !deletedPathsSet.has(r.testPath),
        );
    }

    // Reporter *presentation* order is deterministic by test path, decoupled
    // from *execution* order (which is perf-first and cache/timing dependent —
    // see testSequencer.ts). Without this, the order files appear in reports
    // would shift run-to-run with the sequencer's scheduling. Sort is stable,
    // so individual test cases keep their in-file declaration order.
    const byTestPathAndProject = (
      a: { testPath: string; project: string },
      b: { testPath: string; project: string },
    ) =>
      a.testPath.localeCompare(b.testPath) ||
      a.project.localeCompare(b.project);
    this.reporterResults.results.sort(byTestPathAndProject);
    this.reporterResultIndex.clear();
    this.reporterResults.results.forEach((result, index) => {
      this.reporterResultIndex.set(
        reporterFileKey(result.project, result.testPath),
        index,
      );
    });
    this.reporterResults.testResults.sort(byTestPathAndProject);
  }
}

// `satisfies Record<BuiltInReporterNames, …>` keeps this map in lockstep with
// the BuiltInReporterNames union (the single source of truth): a name added to
// the union without a class here is a missing-key compile error, and a class
// added here without a union entry is an excess-key error. The previous explicit
// object-type annotation duplicated the key list and let the two drift, surfacing
// only as a runtime "Reporter X not found". `satisfies` (not `:`) preserves each
// value's concrete constructor type for the `new reportersMap[name](…)` call.
const reportersMap = {
  default: DefaultReporter,
  dot: DotReporter,
  verbose: VerboseReporter,
  'github-actions': GithubActionsReporter,
  junit: JUnitReporter,
  json: JsonReporter,
  md: MdReporter,
  blob: BlobReporter,
} satisfies Record<BuiltInReporterNames, new (...args: any[]) => unknown>;

const isBuiltInReporterName = (name: string): name is BuiltInReporterNames =>
  name in reportersMap;

async function createReporters(context: InternalContext): Promise<Reporter[]> {
  const result: Reporter[] = [];
  const initConfig = {
    rootPath: context.rootPath,
    config: context.normalizedConfig,
    testState: context.testState,
    fileFilters: context.fileFilters,
    projectConfigs: new Map(
      context.projects.map((project) => [
        project.name,
        project.normalizedConfig,
      ]),
    ),
  };
  let resolver:
    | InstanceType<
        typeof import('@rsbuild/core').rspack.experiments.resolver.ResolverFactory
      >
    | undefined;
  try {
    for (const reporter of castArray(context.normalizedConfig.reporters)) {
      if (typeof reporter === 'function') {
        throw new Error(
          'Reporter classes cannot be passed directly. Pass a reporter instance or [moduleName, options].',
        );
      }
      if (typeof reporter === 'string' || Array.isArray(reporter)) {
        const [name, options = {}] =
          typeof reporter === 'string' ? [reporter, {}] : reporter;
        // built-in reporters
        if (isBuiltInReporterName(name)) {
          // Registration pairs the name with its heterogeneous built-in options.
          const Reporter = reportersMap[name] as new (
            config: typeof initConfig & { options: object },
          ) => Reporter;
          result.push(
            new Reporter({
              ...initConfig,
              options: {
                showProjectName: context.projects.length > 1,
                ...options,
              },
            }),
          );
          continue;
        }

        if (!resolver) {
          const { rspack } = await import('@rsbuild/core');
          // Dynamic import must not select tryResolve's require condition.
          resolver = new rspack.experiments.resolver.ResolverFactory({
            conditionNames: ['node', 'import'],
            extensions: ['.js', '.json', '.node'],
          });
        }
        let modulePath: string;
        try {
          const resolved = resolver.sync(initConfig.rootPath, name);
          if (!resolved.path) throw new Error(resolved.error);
          modulePath = resolved.path;
        } catch (error) {
          throw new Error(`Failed to resolve reporter module "${name}".`, {
            cause: error,
          });
        }
        const loaded = await import(pathToFileURL(modulePath).href);
        if (typeof loaded.default !== 'function') {
          throw new Error(
            `Reporter module "${name}" must have a reporter class as its default export.`,
          );
        }
        const reporterContext: ReporterContext = {
          rootPath: initConfig.rootPath,
          config: initConfig.config,
        };
        result.push(new loaded.default(options, reporterContext));
      } else {
        result.push(reporter);
      }
    }
    if (
      context.command === 'watch' &&
      result.some((reporter) => reporter instanceof BlobReporter)
    ) {
      throw new Error(
        'Blob reporter is not supported in watch mode. Use `rstest run --reporters=blob` to generate reports.',
      );
    }
    return context.command === 'merge-reports'
      ? result.filter((reporter) => !(reporter instanceof BlobReporter))
      : result;
  } catch (error) {
    await exitReporters({ reporters: result });
    throw error;
  }
}
