import { SnapshotManager } from '@vitest/snapshot/manager';
import { isCI } from 'std-env';
import { withDefaultConfig } from '../config';
import { DefaultReporter } from '../reporter';
import { GithubActionsReporter } from '../reporter/githubActions';
import { VerboseReporter } from '../reporter/verbose';
import type {
  NormalizedConfig,
  Project,
  ProjectContext,
  Reporter,
  RstestCommand,
  RstestConfig,
  RstestContext,
  Test,
  TestFileResult,
  TestResult,
} from '../types';
import { castArray, getAbsolutePath } from '../utils/helper';

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
  public reporters: (Reporter | GithubActionsReporter)[];
  public snapshotManager: SnapshotManager;
  public version: string;
  public rootPath: string;
  public originalConfig: RstestConfig;
  public normalizedConfig: NormalizedConfig;
  public idMap: Map<string, Test> = new Map();
  public reporterResults: {
    results: TestFileResult[];
    testResults: TestResult[];
  } = {
    results: [],
    testResults: [],
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

    const rstestConfig = withDefaultConfig(userConfig);
    const reporters =
      command !== 'list'
        ? createReporters(rstestConfig.reporters, {
            rootPath,
            config: rstestConfig,
          })
        : [];
    const snapshotManager = new SnapshotManager({
      updateSnapshot: rstestConfig.update ? 'all' : isCI ? 'none' : 'new',
    });
    this.reporters = reporters;
    this.snapshotManager = snapshotManager;
    this.version = RSTEST_VERSION;
    this.rootPath = rootPath;
    this.originalConfig = userConfig;
    this.normalizedConfig = rstestConfig;
    this.projects = projects.length
      ? projects.map((project) => {
          // TODO: support extend projects config
          const config = withDefaultConfig(project.config);
          return {
            rootPath: config.root,
            name: config.name,
            environmentName: formatEnvironmentName(config.name),
            normalizedConfig: config,
          };
        })
      : [
          {
            rootPath,
            name: rstestConfig.name,
            environmentName: formatEnvironmentName(rstestConfig.name),
            normalizedConfig: rstestConfig,
          },
        ];
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
} = {
  default: DefaultReporter,
  verbose: VerboseReporter,
  'github-actions': GithubActionsReporter,
};

export type BuiltInReporterNames = keyof typeof reportersMap;

export function createReporters(
  reporters: RstestConfig['reporters'],
  initOptions: any = {},
): (Reporter | GithubActionsReporter)[] {
  const result = castArray(reporters).map((reporter) => {
    if (typeof reporter === 'string' || Array.isArray(reporter)) {
      const [name, options = {}] =
        typeof reporter === 'string' ? [reporter, {}] : reporter;
      // built-in reporters
      if (name in reportersMap) {
        const Reporter = reportersMap[name];
        return new Reporter({
          ...initOptions,
          options,
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
