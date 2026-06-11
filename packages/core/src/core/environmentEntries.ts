import type { ProjectContext, ProjectEntries, RstestContext } from '../types';
import { groupProjectEntriesByEnvironment } from './environmentGroups';

type GlobTestSourceEntries = (name: string) => Promise<Record<string, string>>;

const isBrowserProject = (project: ProjectContext): boolean =>
  project.normalizedConfig.browser.enabled;

const hasEntries = (
  entriesCache: Map<string, ProjectEntries>,
  environmentName: string,
): boolean =>
  Object.keys(entriesCache.get(environmentName)?.entries || {}).length > 0;

export const resolveRunnableProjectsByEntries = async ({
  projects,
  entriesCache,
  globTestSourceEntries,
  skipEmptyProjects = true,
}: {
  projects: ProjectContext[];
  entriesCache: Map<string, ProjectEntries>;
  globTestSourceEntries: GlobTestSourceEntries;
  skipEmptyProjects?: boolean;
}): Promise<{
  projects: ProjectContext[];
  entriesCache: Map<string, ProjectEntries>;
  browserProjectsToRun: ProjectContext[];
  nodeProjectsToRun: ProjectContext[];
}> => {
  await Promise.all(
    projects.map((project) => globTestSourceEntries(project.environmentName)),
  );

  const browserProjects = projects.filter(isBrowserProject);
  const grouped = await groupProjectEntriesByEnvironment({
    entriesCache,
    projects: projects.filter((project) => !isBrowserProject(project)),
  });

  const resolvedEntriesCache = grouped.changed
    ? new Map([
        ...Array.from(entriesCache.entries()).filter(([environmentName]) =>
          browserProjects.some(
            (project) => project.environmentName === environmentName,
          ),
        ),
        ...grouped.entriesCache,
      ])
    : entriesCache;
  const resolvedProjects = grouped.changed
    ? [...browserProjects, ...grouped.projects]
    : projects;
  const shouldRunProject = (project: ProjectContext): boolean =>
    !skipEmptyProjects ||
    hasEntries(resolvedEntriesCache, project.environmentName);

  return {
    projects: resolvedProjects,
    entriesCache: resolvedEntriesCache,
    browserProjectsToRun: resolvedProjects.filter(
      (project) => isBrowserProject(project) && shouldRunProject(project),
    ),
    nodeProjectsToRun: resolvedProjects.filter(
      (project) => !isBrowserProject(project) && shouldRunProject(project),
    ),
  };
};

export const applyEnvironmentGroupsToListEntries = async ({
  context,
  testEntries,
  globTestSourceEntries,
}: {
  context: RstestContext;
  testEntries: Record<string, Record<string, string>>;
  globTestSourceEntries: GlobTestSourceEntries;
}): Promise<void> => {
  if (!context.normalizedConfig.shard) {
    await Promise.all(
      context.projects.map((project) =>
        globTestSourceEntries(project.environmentName),
      ),
    );
  }

  const grouped = await groupProjectEntriesByEnvironment({
    entriesCache: new Map(
      Object.entries(testEntries).map(([environmentName, entries]) => [
        environmentName,
        { entries },
      ]),
    ),
    projects: context.projects.filter((project) => !isBrowserProject(project)),
  });

  if (!grouped.changed) {
    return;
  }

  const nodeEnvironmentNames = new Set(
    context.projects
      .filter((project) => !isBrowserProject(project))
      .map((project) => project.environmentName),
  );

  for (const key of Object.keys(testEntries)) {
    if (nodeEnvironmentNames.has(key)) {
      delete testEntries[key];
    }
  }

  for (const [environmentName, entries] of grouped.entriesCache) {
    testEntries[environmentName] = entries.entries;
  }

  context.projects = [
    ...context.projects.filter(isBrowserProject),
    ...grouped.projects,
  ];
};
