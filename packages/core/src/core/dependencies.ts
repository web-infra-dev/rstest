import { ensureCoverageProviderInstalled } from '../coverage';
import type { InternalContext, InternalProjectContext } from '../types';
import { ensureTestEnvironmentDependencies } from './envDependencies';

type EnsureRunDependenciesOptions = {
  projects: InternalProjectContext[];
  rootPath: string;
  coverage: InternalContext['normalizedConfig']['coverage'];
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
