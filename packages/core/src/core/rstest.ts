import { existsSync } from 'node:fs';
import { SnapshotManager } from '@vitest/snapshot/manager';
import { join } from 'pathe';
import { isCI } from 'std-env';
import { withDefaultConfig } from '../config';
import { DefaultReporter } from '../reporter';
import { GithubActionsReporter } from '../reporter/githubActions';
import { JUnitReporter } from '../reporter/junit';
import { MdReporter } from '../reporter/md';
import { VerboseReporter } from '../reporter/verbose';
import type {
  NormalizedConfig,
  NormalizedProjectConfig,
  Project,
  ProjectContext,
  Reporter,
  RstestCommand,
  RstestConfig,
  RstestContext,
  RstestTestState,
  TestFileResult,
  TestResult,
} from '../types';
import { castArray, getAbsolutePath, TS_CONFIG_FILE } from '../utils';
import { TestStateManager } from './stateManager';

/**
 * Only letters, numbers, "-", "_", and "$" are allowed.
 */
function formatEnvironmentName(name: string): string {
  return name.replace(/[^a-zA-Z0-9\-_$]/g, '_');
}

type Options = {
  cwd: string;
  command: RstestCommand;
  fileFilters?: string[];
  configFilePath?: string;
  projects: Project[];
};

export class Rstest implements RstestContext {
  public cwd: string;
  public command: RstestCommand;
  public fileFilters?: string[];
  public configFilePath?: string;
  public reporters: Reporter[];
  public snapshotManager: SnapshotManager;
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

  public projects: ProjectContext[] = [];

  public constructor(
    {
      cwd = process.cwd(),
      command,
      fileFilters,
      configFilePath,
      projects,
    }: Options,
    userConfig: RstestConfig,
  ) {
    this.cwd = cwd;
    this.command = command;
    this.fileFilters = fileFilters;
    this.configFilePath = configFilePath;

    const rootPath = userConfig.root
      ? getAbsolutePath(cwd, userConfig.root)
      : cwd;

    const rstestConfig = withDefaultConfig({
      ...userConfig,
      root: rootPath,
    });

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
          const config = withDefaultConfig(
            project.config,
          ) as NormalizedProjectConfig;
          // some configs are global only
          config.isolate = rstestConfig.isolate;
          config.coverage = rstestConfig.coverage;
          config.bail = rstestConfig.bail;

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
          return {
            configFilePath: project.configFilePath,
            rootPath: config.root,
            name: config.name,
            _globalSetups: false,
            outputModule:
              config.output?.module ??
              process.env.RSTEST_OUTPUT_MODULE !== 'false',
            environmentName: formatEnvironmentName(config.name),
            normalizedConfig: config,
          };
        })
      : [
          {
            configFilePath,
            rootPath,
            _globalSetups: false,
            name: rstestConfig.name,
            outputModule:
              rstestConfig.output?.module ??
              process.env.RSTEST_OUTPUT_MODULE !== 'false',
            environmentName: formatEnvironmentName(rstestConfig.name),
            normalizedConfig: rstestConfig,
          },
        ];

    const reporters =
      command !== 'list'
        ? createReporters(rstestConfig.reporters, {
            rootPath,
            config: rstestConfig,
            testState: this.testState,
            options: {
              showProjectName: projects.length > 1,
            },
          })
        : [];
    this.reporters = reporters;
  }

  public updateReporterResultState(
    results: TestFileResult[],
    testResults: TestResult[],
    deletedEntries: string[] = [],
  ): void {
    // Update or add results
    results.forEach((item) => {
      const existingIndex = this.reporterResults.results.findIndex(
        (r) => r.testPath === item.testPath,
      );
      if (existingIndex !== -1) {
        this.reporterResults.results[existingIndex] = item;
      } else {
        this.reporterResults.results.push(item);
      }
    });

    // Clear existing test results for updated paths and add new ones
    const testPathsToUpdate = new Set(testResults.map((r) => r.testPath));
    this.reporterResults.testResults = this.reporterResults.testResults.filter(
      (r) => !testPathsToUpdate.has(r.testPath),
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
  }
}

const reportersMap: {
  default: typeof DefaultReporter;
  verbose: typeof VerboseReporter;
  'github-actions': typeof GithubActionsReporter;
  junit: typeof JUnitReporter;
  md: typeof MdReporter;
} = {
  default: DefaultReporter,
  verbose: VerboseReporter,
  'github-actions': GithubActionsReporter,
  junit: JUnitReporter,
  md: MdReporter,
};

export type BuiltInReporterNames = keyof typeof reportersMap;

export function createReporters(
  reporters: RstestConfig['reporters'],
  initConfig: any = {},
): (Reporter | GithubActionsReporter | JUnitReporter)[] {
  const result = castArray(reporters).map((reporter) => {
    if (typeof reporter === 'string' || Array.isArray(reporter)) {
      const [name, options = {}] =
        typeof reporter === 'string' ? [reporter, {}] : reporter;
      // built-in reporters
      if (name in reportersMap) {
        const Reporter = reportersMap[name];
        return new Reporter({
          ...initConfig,
          options: {
            ...(initConfig.options || {}),
            ...options,
          },
        });
      }

      // TODO: load third-party reporters
      throw new Error(
        `Reporter ${reporter} not found. Please install it or use a built-in reporter.`,
      );
    }

    return reporter;
  });

  return result;
}
