import { SnapshotManager } from '@vitest/snapshot/manager';
import { isCI } from 'std-env';
import { withDefaultConfig } from '../config';
import { DefaultReporter } from '../reporter';
import { GithubActionsReporter } from '../reporter/githubActions';
import { VerboseReporter } from '../reporter/verbose';
import type { RstestCommand, RstestConfig, RstestContext } from '../types';
import { castArray, getAbsolutePath } from '../utils/helper';

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

function createReporters(
  reporters: RstestConfig['reporters'],
  initOptions: any = {},
) {
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

export function createContext(
  options: {
    cwd: string;
    command: RstestCommand;
    fileFilters?: string[];
    configFilePath?: string;
  },
  userConfig: RstestConfig,
): RstestContext {
  const { cwd, command, fileFilters, configFilePath } = options;
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

  return {
    configFilePath,
    command,
    version: RSTEST_VERSION,
    rootPath,
    reporters,
    fileFilters,
    snapshotManager,
    originalConfig: userConfig,
    normalizedConfig: rstestConfig,
  };
}
