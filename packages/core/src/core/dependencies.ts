import { ensureCoverageProviderInstalled } from '../coverage';
import type { ProjectContext, RstestContext } from '../types';
import { ensureTestEnvironmentDependencies } from './envDependencies';

type EnsureRunDependenciesOptions = {
  projects: ProjectContext[];
  rootPath: string;
  coverage: RstestContext['normalizedConfig']['coverage'];
  checkCoverage?: boolean;
};

export const ensureRunDependencies = async ({
  projects,
  rootPath,
  coverage,
  checkCoverage = true,
}: EnsureRunDependenciesOptions): Promise<void> => {
  if (projects.length) {
    await ensureTestEnvironmentDependencies(projects, rootPath);
  }

  if (checkCoverage && coverage.enabled) {
    await ensureCoverageProviderInstalled(coverage, rootPath);
  }
};
