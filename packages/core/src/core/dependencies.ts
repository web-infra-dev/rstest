import { ensureCoverageProviderInstalled } from '../coverage';
import type { ProjectContext, RstestContext } from '../types';
import { ensureTestEnvironmentDependencies } from './envDependencies';

type EnsureRunDependenciesOptions = {
  projects: ProjectContext[];
  rootPath: string;
  coverage: RstestContext['normalizedConfig']['coverage'];
};

export const ensureRunDependencies = async ({
  projects,
  rootPath,
  coverage,
}: EnsureRunDependenciesOptions): Promise<void> => {
  if (projects.length) {
    await ensureTestEnvironmentDependencies(projects, rootPath);
  }

  if (coverage.enabled) {
    await ensureCoverageProviderInstalled(coverage, rootPath);
  }
};
