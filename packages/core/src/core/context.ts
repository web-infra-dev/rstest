import { SnapshotManager } from '@vitest/snapshot/manager';
import { isCI } from 'std-env';
import { withDefaultConfig } from '../config';
import { DefaultReporter } from '../reporter';
import type {
  Reporter,
  RstestCommand,
  RstestConfig,
  RstestContext,
} from '../types';
import { castArray, getAbsolutePath } from '../utils/helper';

const reportersMap: Record<string, new (...options: any[]) => Reporter> = {
  default: DefaultReporter,
};

export type BuiltInReporterNames = keyof typeof reportersMap;

function createReporters(reporters: RstestConfig['reporters'], options: any) {
  const result = castArray(reporters).map((reporter) => {
    if (typeof reporter === 'string') {
      // built-in reporters
      if (reporter in reportersMap) {
        const Reporter = reportersMap[reporter]!;
        return new Reporter(options);
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
  options: { cwd: string; command: RstestCommand },
  userConfig: RstestConfig,
): RstestContext {
  const { cwd, command } = options;
  const rootPath = userConfig.root
    ? getAbsolutePath(cwd, userConfig.root)
    : cwd;

  const rstestConfig = withDefaultConfig(userConfig);
  const reporters = createReporters(rstestConfig.reporters, { rootPath });
  const snapshotManager = new SnapshotManager({
    updateSnapshot: rstestConfig.update ? 'all' : isCI ? 'none' : 'new',
  });

  return {
    command,
    version: RSTEST_VERSION,
    rootPath,
    reporters,
    snapshotManager,
    originalConfig: userConfig,
    normalizedConfig: rstestConfig,
  };
}
