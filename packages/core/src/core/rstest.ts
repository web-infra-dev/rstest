import { SnapshotManager } from '@vitest/snapshot/manager';
import type {
  NormalizedConfig,
  Reporter,
  RstestCommand,
  RstestConfig,
  RstestContext,
  Test,
  TestFileResult,
  TestResult,
} from 'src/types';
import { isCI } from 'std-env';
import { withDefaultConfig } from '../config';
import { DefaultReporter } from '../reporter';
import { GithubActionsReporter } from '../reporter/githubActions';
import { VerboseReporter } from '../reporter/verbose';
import { castArray, getAbsolutePath } from '../utils/helper';

type Options = {
  cwd: string;
  command: RstestCommand;
  fileFilters?: string[];
  configFilePath?: string;
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

  public constructor(
    { cwd = process.cwd(), command, fileFilters, configFilePath }: Options,
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
  }

  public updateReporter(
    results: TestFileResult[],
    testResults: TestResult[],
    deletedEntries: string[] = [],
  ): void {
    // update results
    for (let i = 0; i < results.length; i++) {
      const item = results[i]!;
      const existingIndex = this.reporterResults.results.findIndex(
        (r) => r.testPath === item.testPath,
      );
      if (existingIndex !== -1) {
        this.reporterResults.results[existingIndex] = item;
      } else {
        this.reporterResults.results.push(item);
      }
    }

    // update test results
    const pathToClear = testResults.map((r) => r.testPath);
    for (const file of pathToClear) {
      this.reporterResults.testResults =
        this.reporterResults.testResults.filter((r) => r.testPath !== file);
    }

    for (let i = 0; i < testResults.length; i++) {
      const item = testResults[i]!;
      this.reporterResults.testResults.push(item);
    }

    // deleted tests that are not in entires
    for (const entry of deletedEntries) {
      this.reporterResults.results = this.reporterResults.results.filter(
        (r) => r.testPath !== entry,
      );
      this.reporterResults.testResults =
        this.reporterResults.testResults.filter((r) => r.testPath !== entry);
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
