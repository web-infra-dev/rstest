import type { ProjectContext, ProjectEntries, RstestContext } from '../types';
import { groupProjectEntriesByEnvironment } from './environmentGroups';
import { isBrowserProject } from './isBrowserProject';

type GlobTestSourceEntries = (name: string) => Promise<Record<string, string>>;

const hasEntries = (
  entriesCache: Map<string, ProjectEntries>,
  environmentName: string,
): boolean =>
  Object.keys(entriesCache.get(environmentName)?.entries || {}).length > 0;

export const resolveRunnableProjectsByEntries = async ({
  projects,
  entriesCache,
  globTestSourceEntries,
  groupEnvironmentComments = true,
  ignoreInvalidEnvironmentComments = false,
  skipEmptyProjects = true,
}: {
  projects: ProjectContext[];
  entriesCache: Map<string, ProjectEntries>;
  globTestSourceEntries: GlobTestSourceEntries;
  groupEnvironmentComments?: boolean;
  ignoreInvalidEnvironmentComments?: boolean;
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
  if (!groupEnvironmentComments) {
    const shouldRunProject = (project: ProjectContext): boolean =>
      !skipEmptyProjects || hasEntries(entriesCache, project.environmentName);

    return {
      projects,
      entriesCache,
      browserProjectsToRun: projects.filter(
        (project) => isBrowserProject(project) && shouldRunProject(project),
      ),
      nodeProjectsToRun: projects.filter(
        (project) => !isBrowserProject(project) && shouldRunProject(project),
      ),
    };
  }

  const grouped = await groupProjectEntriesByEnvironment({
    entriesCache,
    projects: projects.filter((project) => !isBrowserProject(project)),
    ignoreInvalidEnvironmentComments,
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
  ignoreInvalidEnvironmentComments = false,
}: {
  context: RstestContext;
  testEntries: Record<string, Record<string, string>>;
  globTestSourceEntries: GlobTestSourceEntries;
  ignoreInvalidEnvironmentComments?: boolean;
}): Promise<{ changed: boolean }> => {
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
    ignoreInvalidEnvironmentComments,
  });

  if (!grouped.changed) {
    return { changed: false };
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

  return { changed: true };
};
